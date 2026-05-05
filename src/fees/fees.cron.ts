import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import BigNumber from 'bignumber.js';
import { Model, Types } from 'mongoose';
import { fetchSubgraphSwapsForFees } from './fees.subgraph';
import {
  decimal128FromBigNumberFloor6,
  floorToMaxDecimals,
  USD_DECIMALS_MAX,
} from '../common/decimal6';
import {
  FeesIndexerState,
  FeesIndexerStateDocument,
} from './schemas/fees-indexer-state.schema';
import {
  FeesMasterTotal,
  FeesMasterTotalDocument,
} from './schemas/fees-master-total.schema';
import {
  FeesSnapshot,
  FeesSnapshotDocument,
} from './schemas/fees-snapshot.schema';

function parseSnapshotIntervalToSeconds(inputRaw: string | undefined): number {
  const input = String(inputRaw ?? '').trim();
  if (!input) return 86400;

  // Supports: "1h", "6h", "1d", "2w", "30m", "900s"
  const m = input.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)$/i);
  if (!m) return 86400;

  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 86400;

  const unit = m[2].toLowerCase();
  const secPer =
    unit.startsWith('s')
      ? 1
      : unit.startsWith('m')
        ? 60
        : unit.startsWith('h')
          ? 3600
          : unit.startsWith('d')
            ? 86400
            : 604800; // w*

  // Keep within sane bounds (>= 1 minute, <= 8 weeks)
  const sec = Math.floor(n * secPer);
  return Math.min(Math.max(sec, 60), 8 * 7 * 86400);
}

function isoUtcNoMillisFromUnixSeconds(tsSec: number): string {
  return new Date(Math.max(0, Math.floor(tsSec)) * 1000)
    .toISOString()
    .replace('.000Z', 'Z');
}

function bucketStartFromUnixSeconds(tsSec: number, intervalSec: number): number {
  const t = Math.max(0, Math.floor(tsSec));
  const i = Math.max(60, Math.floor(intervalSec));
  return Math.floor(t / i) * i;
}

const V2_FEE_FRACTION = new BigNumber('0.003');
const ONE_MILLION = new BigNumber('1000000');

@Injectable()
export class FeesCron implements OnModuleInit {
  private readonly logger = new Logger(FeesCron.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(FeesIndexerState.name)
    private readonly indexerModel: Model<FeesIndexerStateDocument>,
    @InjectModel(FeesMasterTotal.name)
    private readonly masterModel: Model<FeesMasterTotalDocument>,
    @InjectModel(FeesSnapshot.name)
    private readonly snapshotModel: Model<FeesSnapshotDocument>,
  ) {}

  onModuleInit() {
    this.logger.log('Fees cron initialized');
    void this.runSync('startup');
  }

  // Poll frequently; only emit a snapshot when the configured bucket changes.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async tabulateFeesSnapshotPoll(): Promise<void> {
    await this.runSync('poll');
  }

  private async runSync(trigger: 'startup' | 'poll'): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      this.logger.log(`Fees tabulation started (${trigger})`);

      const urlV2 = this.config.get<string>('POINTS_SUBGRAPH_URL_V2')?.trim();
      const urlV3 = this.config.get<string>('POINTS_SUBGRAPH_URL_V3')?.trim();
      const sources = [
        { key: 'v2' as const, url: urlV2 },
        { key: 'v3' as const, url: urlV3 },
      ].filter((s): s is { key: 'v2' | 'v3'; url: string } => Boolean(s.url));

      if (sources.length === 0) {
        this.logger.warn(
          'POINTS_SUBGRAPH_URL_V2/POINTS_SUBGRAPH_URL_V3 not set; skipping fees tabulation',
        );
        return;
      }

      const pageSize = 500;
      const maxPages = 200; // safe cap

      const nowSec = Math.floor(Date.now() / 1000);
      const intervalSec = parseSnapshotIntervalToSeconds(
        this.config.get<string>('FEES_SNAPSHOT_INTERVAL'),
      );
      const bucketStartSec = bucketStartFromUnixSeconds(nowSec, intervalSec);
      const bucketEndSec = bucketStartSec + intervalSec;
      const snapshotKey = isoUtcNoMillisFromUnixSeconds(bucketStartSec);

      // Don't re-run within the same bucket (unless it's startup and the row
      // doesn't exist yet).
      if (trigger !== 'startup') {
        const existing = await this.snapshotModel.findOne({ _id: snapshotKey });
        if (existing) {
          this.logger.debug(
            `Fees snapshot already exists for bucket=${snapshotKey} intervalSec=${intervalSec}; skipping`,
          );
          return;
        }
      }

      const cursorRanges: FeesSnapshot['cursors'] = {
        v2: { fromTs: 0, fromId: '', toTs: 0, toId: '' },
        v3: { fromTs: 0, fromId: '', toTs: 0, toId: '' },
      };

      let addedV2 = new BigNumber(0);
      let addedV3 = new BigNumber(0);
      let processedV2 = 0;
      let processedV3 = 0;

      for (const source of sources) {
        const state = await this.getOrInitState(source.key);

        let cursorTs = state.lastProcessedTimestampSec;
        let cursorId = state.lastProcessedSwapId;

        cursorRanges[source.key].fromTs = cursorTs;
        cursorRanges[source.key].fromId = cursorId;

        for (let page = 0; page < maxPages; page++) {
          const swaps = await fetchSubgraphSwapsForFees({
            url: source.url,
            source: source.key,
            first: pageSize,
            lastTimestampSec: cursorTs,
            lastSwapId: cursorId,
          });

          if (swaps.length === 0) break;

          for (const s of swaps) {
            const ts = Number((s as { timestamp?: string }).timestamp);
            if (!Number.isFinite(ts) || ts <= 0) continue;

            const amountUsdRaw = String(
              (s as { amountUSD?: string }).amountUSD ?? '',
            ).trim();
            if (!amountUsdRaw) continue;

            const amountUsd = new BigNumber(amountUsdRaw);
            if (!amountUsd.isFinite() || amountUsd.isNaN() || amountUsd.lte(0))
              continue;

            let feeUsd = new BigNumber(0);

            if (source.key === 'v2') {
              feeUsd = amountUsd.times(V2_FEE_FRACTION);
              addedV2 = addedV2.plus(feeUsd);
              processedV2++;
            } else {
              const feeTierRaw = String(
                (s as { pool?: { feeTier?: string } }).pool?.feeTier ?? '',
              ).trim();
              const feeTier = feeTierRaw ? new BigNumber(feeTierRaw) : null;
              if (
                !feeTier ||
                !feeTier.isFinite() ||
                feeTier.isNaN() ||
                feeTier.lt(0)
              ) {
                continue;
              }
              const fraction = feeTier.div(ONE_MILLION);
              feeUsd = amountUsd.times(fraction);
              addedV3 = addedV3.plus(feeUsd);
              processedV3++;
            }

            cursorTs = Math.floor(ts);
            cursorId = String((s as { id?: string }).id);

            // Update cursor progressively for crash safety.
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

        cursorRanges[source.key].toTs = cursorTs;
        cursorRanges[source.key].toId = cursorId;
      }

      const addedTotal = addedV2.plus(addedV3);
      const addedTotal6 = floorToMaxDecimals(addedTotal, USD_DECIMALS_MAX);
      const addedV26 = floorToMaxDecimals(addedV2, USD_DECIMALS_MAX);
      const addedV36 = floorToMaxDecimals(addedV3, USD_DECIMALS_MAX);

      // Ensure master row exists.
      await this.masterModel.updateOne(
        { _id: 'master' },
        {
          $setOnInsert: {
            _id: 'master',
            totalFeesUsd: Types.Decimal128.fromString('0'),
          },
        },
        { upsert: true },
      );

      if (addedTotal.gt(0)) {
        await this.masterModel.updateOne(
          { _id: 'master' },
          {
            $inc: {
              totalFeesUsd: decimal128FromBigNumberFloor6(addedTotal6),
            },
          },
        );
      }

      const master = await this.masterModel.findOne({ _id: 'master' });
      if (!master) throw new Error('fees master total unavailable');

      // Ensure persisted master total never exceeds 6 decimals going forward.
      const masterTotal6Bn = floorToMaxDecimals(
        new BigNumber(master.totalFeesUsd.toString()),
        USD_DECIMALS_MAX,
      );
      const masterTotal6 = Types.Decimal128.fromString(
        masterTotal6Bn.toFixed(),
      );
      await this.masterModel.updateOne(
        { _id: 'master' },
        { $set: { totalFeesUsd: masterTotal6 } },
      );

      const snapshot: FeesSnapshot = {
        _id: snapshotKey,
        bucketStartSec,
        bucketEndSec,
        intervalSec,
        feesAddedUsd: decimal128FromBigNumberFloor6(addedTotal6),
        feesAddedUsdV2: decimal128FromBigNumberFloor6(addedV26),
        feesAddedUsdV3: decimal128FromBigNumberFloor6(addedV36),
        swapsProcessedV2: processedV2,
        swapsProcessedV3: processedV3,
        masterTotalUsdAfter: masterTotal6,
        cursors: cursorRanges,
      };

      await this.snapshotModel.updateOne(
        { _id: snapshotKey },
        { $set: snapshot },
        { upsert: true },
      );

      this.logger.log(
        `Fees snapshot done (${trigger}) bucket=${snapshotKey} intervalSec=${intervalSec} addedUsd=${addedTotal.toFixed()} v2Usd=${addedV2.toFixed()} v3Usd=${addedV3.toFixed()} swapsV2=${processedV2} swapsV3=${processedV3}`,
      );
    } catch (e) {
      this.logger.error(`Fees tabulation failed: ${String(e)}`);
    } finally {
      this.running = false;
    }
  }

  private async getOrInitState(
    id: 'v2' | 'v3',
  ): Promise<FeesIndexerStateDocument> {
    await this.indexerModel.updateOne(
      { _id: id },
      { $setOnInsert: { _id: id } },
      { upsert: true },
    );
    const row = await this.indexerModel.findOne({ _id: id });
    if (!row) throw new Error('fees indexer state unavailable');
    return row;
  }
}
