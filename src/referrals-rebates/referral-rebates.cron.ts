import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import BigNumber from 'bignumber.js';
import { Model } from 'mongoose';
import { fetchRebateSwaps, type RebateSwap } from './referral-rebates.subgraph';
import { decimal128FromBigNumberFloor6 } from '../common/decimal6';
import {
  ReferralIndexerState,
  ReferralIndexerStateDocument,
} from './schemas/referral-indexer-state.schema';
import {
  ReferralFeeAccrual,
  ReferralFeeAccrualDocument,
} from './schemas/referral-fee-accrual.schema';
import {
  ReferralUserState,
  ReferralUserStateDocument,
} from './schemas/referral-user-state.schema';
import type { UpdateResult } from 'mongodb';
import {
  ReferralClaim,
  ReferralClaimDocument,
} from '../referrals/schemas/referral-claim.schema';
import { applyTierPct, getTier, type Tier } from './tier';
import { buildEpochState, rollEpoch, type EpochState } from './epoch';

const V2_FEE_FRACTION = new BigNumber('0.003');
const ONE_MILLION = new BigNumber('1_000_000'.replace(/_/g, ''));

@Injectable()
export class ReferralRebatesCron implements OnModuleInit {
  private readonly logger = new Logger(ReferralRebatesCron.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(ReferralIndexerState.name)
    private readonly indexerModel: Model<ReferralIndexerStateDocument>,
    @InjectModel(ReferralFeeAccrual.name)
    private readonly accrualModel: Model<ReferralFeeAccrualDocument>,
    @InjectModel(ReferralUserState.name)
    private readonly userStateModel: Model<ReferralUserStateDocument>,
    @InjectModel(ReferralClaim.name)
    private readonly claimModel: Model<ReferralClaimDocument>,
  ) {}

  onModuleInit() {
    this.logger.log('Referral rebates cron initialized');
    void this.runSync('startup');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async hourly(): Promise<void> {
    await this.runSync('hourly');
  }

  /**
   * Manually-triggerable entry point (used by tests / backfill scripts /
   * future admin endpoints). Returns processed counts for visibility.
   */
  async runSync(trigger: 'startup' | 'hourly' | 'manual'): Promise<{
    processedV2: number;
    processedV3: number;
    accrualsAdded: number;
  }> {
    if (this.running) {
      this.logger.warn('Skip: another rebate sync is already in flight');
      return { processedV2: 0, processedV3: 0, accrualsAdded: 0 };
    }
    this.running = true;

    try {
      this.logger.log(`Referral rebates tabulation started (${trigger})`);

      const urlV2 = this.config.get<string>('POINTS_SUBGRAPH_URL_V2')?.trim();
      const urlV3 = this.config.get<string>('POINTS_SUBGRAPH_URL_V3')?.trim();
      const sources = [
        { key: 'v2' as const, url: urlV2 },
        { key: 'v3' as const, url: urlV3 },
      ].filter((s): s is { key: 'v2' | 'v3'; url: string } => Boolean(s.url));

      if (sources.length === 0) {
        this.logger.warn(
          'POINTS_SUBGRAPH_URL_V2/POINTS_SUBGRAPH_URL_V3 not set; skipping rebate tabulation',
        );
        return { processedV2: 0, processedV3: 0, accrualsAdded: 0 };
      }

      const pageSize = 200;
      const maxPages = 200;

      let processedV2 = 0;
      let processedV3 = 0;
      let accrualsAdded = 0;

      for (const source of sources) {
        const state = await this.getOrInitState(source.key);
        let cursorTs = state.lastProcessedTimestampSec;
        let cursorId = state.lastProcessedSwapId;

        for (let page = 0; page < maxPages; page++) {
          const swaps = await fetchRebateSwaps({
            url: source.url,
            source: source.key,
            first: pageSize,
            lastTimestampSec: cursorTs,
            lastSwapId: cursorId,
          });

          if (swaps.length === 0) break;

          for (const swap of swaps) {
            const added = await this.processSwap(swap);
            accrualsAdded += added;

            if (source.key === 'v2') processedV2++;
            else processedV3++;

            cursorTs = swap.timestamp;
            cursorId = swap.id;

            await this.indexerModel.updateOne(
              { _id: source.key },
              {
                $set: {
                  lastProcessedTimestampSec: cursorTs,
                  lastProcessedSwapId: cursorId,
                },
              },
              { upsert: true },
            );
          }
        }
      }

      this.logger.log(
        `Referral rebates tabulation done (${trigger}) v2=${processedV2} v3=${processedV3} accrualsAdded=${accrualsAdded}`,
      );

      return { processedV2, processedV3, accrualsAdded };
    } catch (e) {
      this.logger.error(`Referral rebates tabulation failed: ${String(e)}`);
      return { processedV2: 0, processedV3: 0, accrualsAdded: 0 };
    } finally {
      this.running = false;
    }
  }

  /**
   * Compute fees, walk L1 + L2 referrers, upsert an accrual row per recipient.
   * Returns how many new rows were inserted (0..2).
   */
  private async processSwap(swap: RebateSwap): Promise<number> {
    const inputAmountHuman = new BigNumber(swap.inputAmountHuman);
    if (
      !inputAmountHuman.isFinite() ||
      inputAmountHuman.isNaN() ||
      inputAmountHuman.lte(0)
    ) {
      return 0;
    }

    const feeFraction = this.feeFractionFor(swap);
    if (!feeFraction || feeFraction.lte(0)) return 0;

    const amountUsd = new BigNumber(swap.amountUsd || '0');
    const totalFeeUsd =
      amountUsd.isFinite() && amountUsd.gte(0)
        ? amountUsd.times(feeFraction)
        : new BigNumber(0);

    const totalFeeRaw = inputAmountHuman
      .times(feeFraction)
      .shiftedBy(swap.inputTokenDecimals)
      .integerValue(BigNumber.ROUND_FLOOR);

    if (totalFeeRaw.lte(0)) return 0;

    // Find L1 (direct inviter) and L2 (inviter of inviter), if any.
    const l1Claim = (await this.claimModel
      .findOne({ referredAddress: swap.payerAddress })
      .lean()) as Pick<ReferralClaim, 'inviterAddress'> | null;
    const l1Address = l1Claim?.inviterAddress?.toLowerCase() ?? null;
    if (!l1Address) return 0;

    let l2Address: string | null = null;
    const l2Claim = (await this.claimModel
      .findOne({ referredAddress: l1Address })
      .lean()) as Pick<ReferralClaim, 'inviterAddress'> | null;
    if (l2Claim?.inviterAddress) {
      l2Address = l2Claim.inviterAddress.toLowerCase();
    }

    let added = 0;

    added += await this.upsertAccrual({
      swap,
      recipient: l1Address,
      level: 1,
      totalFeeRaw,
      totalFeeUsd,
    });

    if (l2Address) {
      added += await this.upsertAccrual({
        swap,
        recipient: l2Address,
        level: 2,
        totalFeeRaw,
        totalFeeUsd,
      });
    }

    return added;
  }

  private feeFractionFor(swap: RebateSwap): BigNumber | null {
    if (swap.source === 'v2') return V2_FEE_FRACTION;
    const tier = swap.feeTier ? new BigNumber(swap.feeTier) : null;
    if (!tier || !tier.isFinite() || tier.isNaN() || tier.lt(0)) return null;
    return tier.div(ONE_MILLION);
  }

  private async upsertAccrual(input: {
    swap: RebateSwap;
    recipient: string;
    level: 1 | 2;
    totalFeeRaw: BigNumber;
    totalFeeUsd: BigNumber;
  }): Promise<number> {
    const { swap, recipient, level, totalFeeRaw, totalFeeUsd } = input;

    const userState = await this.refreshUserState(recipient, swap.timestamp);
    const tier = getTier(userState.directReferralsCount);
    const pct = level === 1 ? tier.l1Pct : tier.l2Pct;

    const shareRaw = applyTierPct(totalFeeRaw, pct).integerValue(
      BigNumber.ROUND_FLOOR,
    );
    if (shareRaw.lte(0)) return 0;

    const shareUsd = applyTierPct(totalFeeUsd, pct);

    const result = (await this.accrualModel.updateOne(
      {
        source: swap.source,
        swapId: swap.id,
        recipientAddress: recipient,
        level,
      },
      {
        $setOnInsert: {
          source: swap.source,
          swapId: swap.id,
          recipientAddress: recipient,
          payerAddress: swap.payerAddress,
          level,
          tokenAddress: swap.inputTokenAddress,
          tokenSymbol: swap.inputTokenSymbol,
          tokenDecimals: swap.inputTokenDecimals,
          feeAmountRaw: shareRaw.toFixed(),
          feeAmountUsd: decimal128FromBigNumberFloor6(shareUsd),
          tierPctApplied: pct.toFixed(),
          recipientEpochId: userState.currentEpochId,
          swapTimestamp: swap.timestamp,
        },
      },
      { upsert: true },
    )) as UpdateResult;

    return result.upsertedCount ?? 0;
  }

  /**
   * Make sure the recipient's user state is up-to-date for `nowSec`:
   *   1. Recompute `directReferralsCount` from the canonical claims table.
   *   2. Re-resolve their tier.
   *   3. Roll the epoch forward if it has expired.
   */
  private async refreshUserState(
    recipient: string,
    nowSec: number,
  ): Promise<ReferralUserStateDocument> {
    const directCount = await this.claimModel.countDocuments({
      inviterAddress: recipient,
    });
    const tier: Tier = getTier(directCount);

    let doc = await this.userStateModel.findById(recipient);
    if (!doc) {
      const epoch = buildEpochState(tier.tierIndex, nowSec, tier.epochDays);
      doc = await this.userStateModel.create({
        _id: recipient,
        directReferralsCount: directCount,
        currentTierIndex: tier.tierIndex,
        currentEpochId: epoch.epochId,
        currentEpochStartedAt: epoch.startedAtSec,
        currentEpochLengthDays: epoch.lengthDays,
      });
      return doc;
    }

    const currentEpoch: EpochState =
      doc.currentEpochStartedAt > 0
        ? {
            epochId: doc.currentEpochId,
            startedAtSec: doc.currentEpochStartedAt,
            endsAtSec:
              doc.currentEpochStartedAt + doc.currentEpochLengthDays * 86_400,
            lengthDays: doc.currentEpochLengthDays,
          }
        : buildEpochState(tier.tierIndex, nowSec, tier.epochDays);

    // `rollEpoch` is a no-op while the epoch is still open and restarts on the
    // new tier's clock when it isn't, so tier changes mid-epoch just apply the
    // new % to subsequent accruals without disturbing the boundary.
    const nextEpoch = rollEpoch(
      currentEpoch,
      tier.tierIndex,
      tier.epochDays,
      nowSec,
    );

    const set: Partial<ReferralUserState> = {
      directReferralsCount: directCount,
      currentTierIndex: tier.tierIndex,
    };

    if (
      nextEpoch.epochId !== doc.currentEpochId ||
      doc.currentEpochStartedAt !== nextEpoch.startedAtSec ||
      doc.currentEpochLengthDays !== nextEpoch.lengthDays
    ) {
      set.currentEpochId = nextEpoch.epochId;
      set.currentEpochStartedAt = nextEpoch.startedAtSec;
      set.currentEpochLengthDays = nextEpoch.lengthDays;
    }

    await this.userStateModel.updateOne({ _id: recipient }, { $set: set });
    Object.assign(doc, set);
    return doc;
  }

  private async getOrInitState(
    id: 'v2' | 'v3',
  ): Promise<ReferralIndexerStateDocument> {
    await this.indexerModel.updateOne(
      { _id: id },
      { $setOnInsert: { _id: id } },
      { upsert: true },
    );
    const row = await this.indexerModel.findOne({ _id: id });
    if (!row) throw new Error('referral indexer state unavailable');
    return row;
  }
}
