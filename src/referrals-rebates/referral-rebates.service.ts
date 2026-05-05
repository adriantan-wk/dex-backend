import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import BigNumber from 'bignumber.js';
import { Model, Types } from 'mongoose';
import { isAddress } from 'viem';
import {
  ReferralFeeAccrual,
  ReferralFeeAccrualDocument,
} from './schemas/referral-fee-accrual.schema';
import {
  ReferralUserState,
  ReferralUserStateDocument,
} from './schemas/referral-user-state.schema';
import {
  ReferralClaim,
  ReferralClaimDocument,
} from '../referrals/schemas/referral-claim.schema';
import { getTier, TIER_TABLE } from './tier';
import { buildEpochState, isEpochClosed } from './epoch';

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function isEvmAddress(address: string): boolean {
  return isAddress(address, { strict: false });
}

function decimal128ToString(v: Types.Decimal128 | string | undefined): string {
  if (!v) return '0';
  return typeof v === 'string' ? v : v.toString();
}

export type TokenAmount = {
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  amountRaw: string;
  amountUsd: string;
};

export type RecipientSummary = {
  address: string;
  tier: {
    index: number;
    minDirectReferrals: number;
    l1Pct: string;
    l2Pct: string;
    epochDays: number;
  };
  directReferralsCount: number;
  currentEpoch: {
    epochId: string;
    startedAtSec: number;
    endsAtSec: number;
    isClosed: boolean;
  };
  lifetimeByToken: TokenAmount[];
  claimableByToken: TokenAmount[];
  pendingByToken: TokenAmount[];
  totals: {
    lifetimeUsd: string;
    claimableUsd: string;
    pendingUsd: string;
    accrualRowCount: number;
  };
};

export type AdminUsersListItem = {
  address: string;
  directReferralsCount: number;
  tierIndex: number;
  l1Pct: string;
  l2Pct: string;
  lifetimeUsd: string;
  claimableUsd: string;
  pendingUsd: string;
  accrualRowCount: number;
};

export type AdminUsersListResult = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rows: AdminUsersListItem[];
};

type AccrualGroupRow = {
  _id: { tokenAddress: string };
  tokenSymbol: string;
  tokenDecimals: number;
  amountRaw: string;
  amountUsd: Types.Decimal128;
};

type AccrualByPayerRow = {
  _id: { payerAddress: string; level: 1 | 2; tokenAddress: string };
  tokenSymbol: string;
  tokenDecimals: number;
  amountRaw: string;
  amountUsd: Types.Decimal128;
  swapCount: number;
};

@Injectable()
export class ReferralRebatesService {
  constructor(
    @InjectModel(ReferralFeeAccrual.name)
    private readonly accrualModel: Model<ReferralFeeAccrualDocument>,
    @InjectModel(ReferralUserState.name)
    private readonly userStateModel: Model<ReferralUserStateDocument>,
    @InjectModel(ReferralClaim.name)
    private readonly claimModel: Model<ReferralClaimDocument>,
  ) {}

  async getRecipientSummary(addressRaw: string): Promise<RecipientSummary> {
    const address = normalizeAddress(addressRaw);
    if (!isEvmAddress(address)) {
      throw new BadRequestException('Invalid address');
    }

    const directReferralsCount = await this.claimModel.countDocuments({
      inviterAddress: address,
    });
    const tier = getTier(directReferralsCount);

    const userState = await this.userStateModel.findById(address).lean();
    const nowSec = Math.floor(Date.now() / 1000);

    const epochStartedAt = userState?.currentEpochStartedAt ?? nowSec;
    const epochLengthDays = userState?.currentEpochLengthDays ?? tier.epochDays;
    const epoch = buildEpochState(
      userState?.currentTierIndex ?? tier.tierIndex,
      epochStartedAt,
      epochLengthDays,
    );

    // Aggregations: group by token, partitioned by epoch state.
    const allByToken = await this.aggregateByToken({
      recipientAddress: address,
    });

    const closedEpochIds = await this.collectClosedEpochIds(address, nowSec);
    const claimableByToken = closedEpochIds.length
      ? await this.aggregateByToken({
          recipientAddress: address,
          recipientEpochId: { $in: closedEpochIds },
        })
      : [];

    const pendingByToken = await this.aggregateByToken({
      recipientAddress: address,
      recipientEpochId: epoch.epochId,
    });

    const accrualRowCount = await this.accrualModel.countDocuments({
      recipientAddress: address,
    });

    return {
      address,
      tier: {
        index: tier.tierIndex,
        minDirectReferrals: tier.minDirectReferrals,
        l1Pct: tier.l1Pct.toFixed(),
        l2Pct: tier.l2Pct.toFixed(),
        epochDays: tier.epochDays,
      },
      directReferralsCount,
      currentEpoch: {
        epochId: epoch.epochId,
        startedAtSec: epoch.startedAtSec,
        endsAtSec: epoch.endsAtSec,
        isClosed: isEpochClosed(epoch, nowSec),
      },
      lifetimeByToken: allByToken,
      claimableByToken,
      pendingByToken,
      totals: {
        lifetimeUsd: sumUsd(allByToken),
        claimableUsd: sumUsd(claimableByToken),
        pendingUsd: sumUsd(pendingByToken),
        accrualRowCount,
      },
    };
  }

  async getRecipientByReferee(addressRaw: string): Promise<{
    address: string;
    rows: Array<{
      payerAddress: string;
      level: 1 | 2;
      tokenAddress: string;
      tokenSymbol: string;
      tokenDecimals: number;
      amountRaw: string;
      amountUsd: string;
      swapCount: number;
    }>;
  }> {
    const address = normalizeAddress(addressRaw);
    if (!isEvmAddress(address)) {
      throw new BadRequestException('Invalid address');
    }

    const rows = await this.accrualModel.aggregate<AccrualByPayerRow>([
      { $match: { recipientAddress: address } },
      {
        $group: {
          _id: {
            payerAddress: '$payerAddress',
            level: '$level',
            tokenAddress: '$tokenAddress',
          },
          tokenSymbol: { $first: '$tokenSymbol' },
          tokenDecimals: { $first: '$tokenDecimals' },
          amountRaw: { $sum: { $toDecimal: '$feeAmountRaw' } },
          amountUsd: { $sum: '$feeAmountUsd' },
          swapCount: { $sum: 1 },
        },
      },
      { $sort: { amountUsd: -1 } },
    ]);

    return {
      address,
      rows: rows.map((r) => ({
        payerAddress: r._id.payerAddress,
        level: r._id.level,
        tokenAddress: r._id.tokenAddress,
        tokenSymbol: r.tokenSymbol,
        tokenDecimals: r.tokenDecimals,
        amountRaw: new BigNumber(r.amountRaw.toString())
          .integerValue(BigNumber.ROUND_FLOOR)
          .toFixed(),
        amountUsd: decimal128ToString(r.amountUsd),
        swapCount: r.swapCount,
      })),
    };
  }

  async getAdminUsers(input: {
    page?: number;
    pageSize?: number;
    sort?: 'lifetimeUsd' | 'claimableUsd' | 'directReferrals';
  }): Promise<AdminUsersListResult> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Math.floor(input.pageSize ?? 25)),
    );
    const sort = input.sort ?? 'lifetimeUsd';

    const totalsByRecipient = await this.accrualModel.aggregate<{
      _id: string;
      lifetimeUsd: Types.Decimal128;
      accrualRowCount: number;
    }>([
      {
        $group: {
          _id: '$recipientAddress',
          lifetimeUsd: { $sum: '$feeAmountUsd' },
          accrualRowCount: { $sum: 1 },
        },
      },
    ]);

    const totalsMap = new Map<
      string,
      { lifetimeUsd: string; accrualRowCount: number }
    >();
    for (const row of totalsByRecipient) {
      totalsMap.set(row._id, {
        lifetimeUsd: decimal128ToString(row.lifetimeUsd),
        accrualRowCount: row.accrualRowCount,
      });
    }

    // Pull every known recipient (anyone with state OR accruals).
    const states = await this.userStateModel.find({}).lean();
    const knownAddresses = new Set<string>();
    for (const s of states) knownAddresses.add(s._id);
    for (const a of totalsMap.keys()) knownAddresses.add(a);

    const items: AdminUsersListItem[] = [];

    for (const address of knownAddresses) {
      const state = states.find((s) => s._id === address);
      const directReferralsCount = state?.directReferralsCount ?? 0;
      const tier = getTier(directReferralsCount);
      const totals = totalsMap.get(address) ?? {
        lifetimeUsd: '0',
        accrualRowCount: 0,
      };

      const nowSec = Math.floor(Date.now() / 1000);
      const claimableUsdRaw = state
        ? await this.claimableUsdFor(address, state, nowSec)
        : '0';
      const pendingUsdRaw = state
        ? await this.pendingUsdFor(address, state)
        : '0';

      items.push({
        address,
        directReferralsCount,
        tierIndex: state?.currentTierIndex ?? tier.tierIndex,
        l1Pct: tier.l1Pct.toFixed(),
        l2Pct: tier.l2Pct.toFixed(),
        lifetimeUsd: totals.lifetimeUsd,
        claimableUsd: claimableUsdRaw,
        pendingUsd: pendingUsdRaw,
        accrualRowCount: totals.accrualRowCount,
      });
    }

    items.sort((a, b) => {
      if (sort === 'directReferrals') {
        return b.directReferralsCount - a.directReferralsCount;
      }
      const k = sort === 'claimableUsd' ? 'claimableUsd' : 'lifetimeUsd';
      return new BigNumber(b[k]).comparedTo(new BigNumber(a[k])) ?? 0;
    });

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const rows = items.slice(start, start + pageSize);

    return { page, pageSize, total, totalPages, rows };
  }

  async getAdminUserBreakdown(addressRaw: string): Promise<{
    summary: RecipientSummary;
    referees: Awaited<
      ReturnType<ReferralRebatesService['getRecipientByReferee']>
    >['rows'];
    /** Per-epoch totals for this recipient. */
    epochs: Array<{
      epochId: string;
      tierIndex: number;
      startedAtSec: number;
      lengthDays: number;
      isClosed: boolean;
      totalUsd: string;
      tokens: TokenAmount[];
    }>;
  }> {
    const address = normalizeAddress(addressRaw);
    if (!isEvmAddress(address)) {
      throw new BadRequestException('Invalid address');
    }

    const summary = await this.getRecipientSummary(address);
    const byReferee = await this.getRecipientByReferee(address);

    const epochsAgg = await this.accrualModel.aggregate<{
      _id: { epochId: string; tokenAddress: string };
      tokenSymbol: string;
      tokenDecimals: number;
      amountRaw: string;
      amountUsd: Types.Decimal128;
    }>([
      { $match: { recipientAddress: address } },
      {
        $group: {
          _id: {
            epochId: '$recipientEpochId',
            tokenAddress: '$tokenAddress',
          },
          tokenSymbol: { $first: '$tokenSymbol' },
          tokenDecimals: { $first: '$tokenDecimals' },
          amountRaw: { $sum: { $toDecimal: '$feeAmountRaw' } },
          amountUsd: { $sum: '$feeAmountUsd' },
        },
      },
    ]);

    const nowSec = Math.floor(Date.now() / 1000);
    const epochsMap = new Map<
      string,
      {
        epochId: string;
        tierIndex: number;
        startedAtSec: number;
        lengthDays: number;
        isClosed: boolean;
        totalUsd: BigNumber;
        tokens: TokenAmount[];
      }
    >();

    for (const row of epochsAgg) {
      const epochId = row._id.epochId;
      const [tierIndexStr, startedAtStr] = epochId.split(':');
      const tierIndex = Math.max(0, Math.floor(Number(tierIndexStr) || 0));
      const startedAtSec = Math.max(0, Math.floor(Number(startedAtStr) || 0));
      const lengthDays =
        TIER_TABLE[Math.min(tierIndex, TIER_TABLE.length - 1)]?.epochDays ?? 14;
      const epoch = buildEpochState(tierIndex, startedAtSec, lengthDays);
      const isClosed = isEpochClosed(epoch, nowSec);

      const usd = new BigNumber(decimal128ToString(row.amountUsd));
      const tokenAmount: TokenAmount = {
        tokenAddress: row._id.tokenAddress,
        tokenSymbol: row.tokenSymbol,
        tokenDecimals: row.tokenDecimals,
        amountRaw: new BigNumber(row.amountRaw.toString())
          .integerValue(BigNumber.ROUND_FLOOR)
          .toFixed(),
        amountUsd: usd.toFixed(),
      };

      const existing = epochsMap.get(epochId);
      if (existing) {
        existing.totalUsd = existing.totalUsd.plus(usd);
        existing.tokens.push(tokenAmount);
      } else {
        epochsMap.set(epochId, {
          epochId,
          tierIndex,
          startedAtSec,
          lengthDays,
          isClosed,
          totalUsd: usd,
          tokens: [tokenAmount],
        });
      }
    }

    const epochs = Array.from(epochsMap.values())
      .map((e) => ({
        epochId: e.epochId,
        tierIndex: e.tierIndex,
        startedAtSec: e.startedAtSec,
        lengthDays: e.lengthDays,
        isClosed: e.isClosed,
        totalUsd: e.totalUsd.toFixed(),
        tokens: e.tokens,
      }))
      .sort((a, b) => b.startedAtSec - a.startedAtSec);

    return { summary, referees: byReferee.rows, epochs };
  }

  /**
   * Aggregate accrual rows for a recipient (optionally filtered) into one row
   * per token.
   */
  private async aggregateByToken(
    match: Record<string, unknown>,
  ): Promise<TokenAmount[]> {
    const rows = await this.accrualModel.aggregate<AccrualGroupRow>([
      { $match: match },
      {
        $group: {
          _id: { tokenAddress: '$tokenAddress' },
          tokenSymbol: { $first: '$tokenSymbol' },
          tokenDecimals: { $first: '$tokenDecimals' },
          amountRaw: { $sum: { $toDecimal: '$feeAmountRaw' } },
          amountUsd: { $sum: '$feeAmountUsd' },
        },
      },
      { $sort: { amountUsd: -1 } },
    ]);

    return rows.map((r) => ({
      tokenAddress: r._id.tokenAddress,
      tokenSymbol: r.tokenSymbol,
      tokenDecimals: r.tokenDecimals,
      amountRaw: new BigNumber(r.amountRaw.toString())
        .integerValue(BigNumber.ROUND_FLOOR)
        .toFixed(),
      amountUsd: decimal128ToString(r.amountUsd),
    }));
  }

  /**
   * "Closed epoch ids" = every distinct epoch id in the recipient's accruals
   * whose window has expired. Used to bucket claimable accruals.
   */
  private async collectClosedEpochIds(
    recipient: string,
    nowSec: number,
  ): Promise<string[]> {
    const ids = await this.accrualModel.distinct<string>('recipientEpochId', {
      recipientAddress: recipient,
    });

    const out: string[] = [];
    for (const raw of ids) {
      const epochId = String(raw);
      const [tierIndexStr, startedAtStr] = epochId.split(':');
      const tierIndex = Math.max(0, Math.floor(Number(tierIndexStr) || 0));
      const startedAtSec = Math.max(0, Math.floor(Number(startedAtStr) || 0));
      const lengthDays =
        TIER_TABLE[Math.min(tierIndex, TIER_TABLE.length - 1)]?.epochDays ?? 14;
      const epoch = buildEpochState(tierIndex, startedAtSec, lengthDays);
      if (isEpochClosed(epoch, nowSec)) out.push(epochId);
    }
    return out;
  }

  private async claimableUsdFor(
    address: string,
    state: ReferralUserState,
    nowSec: number,
  ): Promise<string> {
    const closed = await this.collectClosedEpochIds(address, nowSec);
    if (!closed.length) return '0';
    const rows = await this.accrualModel.aggregate<{
      _id: null;
      total: Types.Decimal128;
    }>([
      {
        $match: {
          recipientAddress: address,
          recipientEpochId: { $in: closed },
        },
      },
      { $group: { _id: null, total: { $sum: '$feeAmountUsd' } } },
    ]);
    return decimal128ToString(rows[0]?.total);
  }

  private async pendingUsdFor(
    address: string,
    state: ReferralUserState,
  ): Promise<string> {
    if (!state.currentEpochId) return '0';
    const rows = await this.accrualModel.aggregate<{
      _id: null;
      total: Types.Decimal128;
    }>([
      {
        $match: {
          recipientAddress: address,
          recipientEpochId: state.currentEpochId,
        },
      },
      { $group: { _id: null, total: { $sum: '$feeAmountUsd' } } },
    ]);
    return decimal128ToString(rows[0]?.total);
  }
}

function sumUsd(rows: TokenAmount[]): string {
  let total = new BigNumber(0);
  for (const r of rows) total = total.plus(r.amountUsd);
  return total.toFixed();
}
