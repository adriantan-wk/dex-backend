import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import BigNumber from 'bignumber.js';
import {
  PointsAccount,
  PointsAccountDocument,
} from './schemas/points-account.schema';
import {
  PointsDaily,
  PointsDailyDocument,
} from './schemas/points-daily.schema';
import {
  PointsLedgerEntry,
  PointsLedgerEntryDocument,
} from './schemas/points-ledger-entry.schema';
import {
  PointsSeasonState,
  PointsSeasonStateDocument,
} from './schemas/points-season-state.schema';
import {
  PointsSeasonLeaderboardRow,
  PointsSeasonSnapshot,
  PointsSeasonSnapshotDocument,
} from './schemas/points-season-snapshot.schema';

const SEASON_ID_REGEX = /^\d{4}-\d{2}$/;
const ZERO = () => Types.Decimal128.fromString('0');

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function normalizeTxHash(txHash: string): string {
  return txHash.trim().toLowerCase();
}

function isEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isTxHash(txHash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(txHash);
}

function toDecimal128String(input: string): string {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error('Invalid decimal string');
  }
  return s;
}

function decimalToString(d: Types.Decimal128): string {
  // Mongoose Decimal128 serializes oddly in JSON; always normalize to string.
  return d.toString();
}

function utcDayIndexFromUnixSeconds(unixSeconds: number): number {
  return Math.floor(unixSeconds / 86400);
}

function multiplierForStreakDay(streakDay: number): BigNumber {
  const d = Math.max(1, Math.floor(streakDay));
  const m = new BigNumber('1').plus(new BigNumber('0.1').times(d - 1));
  return BigNumber.minimum(m, new BigNumber('2.0'));
}

/** UTC calendar month key: YYYY-MM */
function utcSeasonIdFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function nextUtcSeasonId(seasonId: string): string {
  const [ys, ms] = seasonId.split('-');
  const y = Number(ys);
  const mo = Number(ms);
  const d = new Date(Date.UTC(y, mo - 1 + 1, 1));
  return utcSeasonIdFromDate(d);
}

function compareSeasonId(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

@Injectable()
export class PointsService implements OnModuleInit {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    @InjectModel(PointsAccount.name)
    private readonly accountModel: Model<PointsAccountDocument>,
    @InjectModel(PointsDaily.name)
    private readonly dailyModel: Model<PointsDailyDocument>,
    @InjectModel(PointsLedgerEntry.name)
    private readonly ledgerModel: Model<PointsLedgerEntryDocument>,
    @InjectModel(PointsSeasonState.name)
    private readonly seasonStateModel: Model<PointsSeasonStateDocument>,
    @InjectModel(PointsSeasonSnapshot.name)
    private readonly seasonSnapshotModel: Model<PointsSeasonSnapshotDocument>,
  ) {}

  onModuleInit() {
    void this.ensureSeasonRollover().catch((e) =>
      this.logger.warn(`Season rollover on boot: ${String(e)}`),
    );
  }

  private async getOrInitSeasonStateRow(): Promise<PointsSeasonStateDocument> {
    const target = utcSeasonIdFromDate(new Date());
    await this.seasonStateModel.updateOne(
      {},
      { $setOnInsert: { activeSeasonId: target } },
      { upsert: true },
    );
    const row = await this.seasonStateModel.findOne({});
    if (!row) {
      throw new Error('points season state unavailable');
    }
    return row;
  }

  /**
   * When UTC month advances, snapshot the top 50 for the ending season, reset
   * swap totals and streak state, then move `activeSeasonId` forward (possibly
   * across multiple months if the process was idle).
   */
  async ensureSeasonRollover(): Promise<void> {
    const target = utcSeasonIdFromDate(new Date());
    const maxSteps = 36;

    for (let step = 0; step < maxSteps; step++) {
      const row = await this.getOrInitSeasonStateRow();
      if (compareSeasonId(row.activeSeasonId, target) >= 0) return;

      const ending = row.activeSeasonId;
      const nextId = nextUtcSeasonId(ending);

      const top = await this.accountModel
        .find({})
        .sort({ swapPoints: -1 })
        .limit(50)
        .lean();

      const entries: PointsSeasonLeaderboardRow[] = top.map((r, i) => ({
        rank: i + 1,
        address: r.address,
        swapPoints: decimalToString(r.swapPoints),
        swapUsdVolume: decimalToString(r.swapUsdVolume),
      }));

      await this.seasonSnapshotModel.updateOne(
        { seasonId: ending },
        {
          $set: {
            seasonId: ending,
            finalizedAt: new Date(),
            entries,
          },
        },
        { upsert: true },
      );

      const advanced = await this.seasonStateModel.findOneAndUpdate(
        { activeSeasonId: ending },
        { $set: { activeSeasonId: nextId } },
        { new: true },
      );

      if (!advanced) {
        continue;
      }

      await this.accountModel.updateMany(
        {},
        {
          $set: {
            swapPoints: ZERO(),
            swapUsdVolume: ZERO(),
            swapStreakDay: 0,
            swapMultiplier: Types.Decimal128.fromString('1'),
            lastSwapDayIndex: null,
          },
        },
      );

      await this.dailyModel.deleteMany({});
    }
  }

  async getActiveSeasonId(): Promise<string> {
    const row = await this.getOrInitSeasonStateRow();
    return row.activeSeasonId;
  }

  async listSeasons(): Promise<{ seasons: string[]; activeSeasonId: string }> {
    await this.ensureSeasonRollover();
    const activeSeasonId = await this.getActiveSeasonId();

    const snaps = await this.seasonSnapshotModel
      .find({}, { seasonId: 1 })
      .sort({ seasonId: -1 })
      .lean();

    const set = new Set<string>();
    for (const s of snaps) set.add(s.seasonId);
    set.add(activeSeasonId);

    const seasons = [...set].sort((a, b) => compareSeasonId(b, a));
    return { seasons, activeSeasonId };
  }

  async getAccount(address: string) {
    await this.ensureSeasonRollover();

    const normalized = normalizeAddress(address);
    const account = await this.accountModel.findOne({ address: normalized });
    if (!account) {
      return {
        address: normalized,
        swapPoints: '0',
        swapUsdVolume: '0',
        swapStreakDay: 0,
        swapMultiplier: '1',
        lastSwapDayIndex: null,
      };
    }
    return {
      address: account.address,
      swapPoints: decimalToString(account.swapPoints),
      swapUsdVolume: decimalToString(account.swapUsdVolume),
      swapStreakDay: account.swapStreakDay,
      swapMultiplier: decimalToString(account.swapMultiplier),
      lastSwapDayIndex: account.lastSwapDayIndex ?? null,
    };
  }

  async listLedger(address: string, limit: number) {
    const normalized = normalizeAddress(address);
    const clampedLimit = Math.max(1, Math.min(200, limit));

    const entries = await this.ledgerModel
      .find({ address: normalized })
      .sort({ createdAt: -1 })
      .limit(clampedLimit);

    return entries.map((e) => ({
      id: e._id.toString(),
      address: e.address,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      chainId: e.chainId,
      usdAmount: decimalToString(e.usdAmount),
      points: decimalToString(e.points),
      multiplier: decimalToString(e.multiplier),
      pointsFormulaVersion: e.pointsFormulaVersion,
      createdAt: (
        e as unknown as { createdAt?: Date }
      ).createdAt?.toISOString(),
      metadata: e.metadata ?? undefined,
    }));
  }

  async getLeaderboard(limit: number, seasonParam?: string) {
    await this.ensureSeasonRollover();

    const requested =
      typeof seasonParam === 'string' && SEASON_ID_REGEX.test(seasonParam.trim())
        ? seasonParam.trim()
        : undefined;

    const activeSeasonId = await this.getActiveSeasonId();
    const seasonId = requested ?? activeSeasonId;

    if (requested && compareSeasonId(requested, activeSeasonId) > 0) {
      return {
        seasonId,
        activeSeasonId,
        isHistorical: false,
        entries: [] as { address: string; swapPoints: string; swapUsdVolume: string }[],
      };
    }

    if (!requested || requested === activeSeasonId) {
      const n = Math.max(1, Math.min(limit || 50, 200));
      const rows = await this.accountModel
        .find({})
        .sort({ swapPoints: -1 })
        .limit(n);

      return {
        seasonId: activeSeasonId,
        activeSeasonId,
        isHistorical: false,
        entries: rows.map((r) => ({
          address: r.address,
          swapPoints: decimalToString(r.swapPoints),
          swapUsdVolume: decimalToString(r.swapUsdVolume),
        })),
      };
    }

    const snap = await this.seasonSnapshotModel.findOne({ seasonId }).lean();
    const n = Math.max(1, Math.min(limit || 50, 200));
    const slice = snap?.entries.slice(0, n) ?? [];

    return {
      seasonId,
      activeSeasonId,
      isHistorical: true,
      entries: slice.map((r) => ({
        address: r.address,
        swapPoints: r.swapPoints,
        swapUsdVolume: r.swapUsdVolume,
      })),
    };
  }

  async awardPointsFromSwap(input: {
    address: string;
    txHash: string;
    chainId: number;
    usdAmount: string;
    swapTimestampSec?: number;
    metadata?: Record<string, unknown>;
  }) {
    await this.ensureSeasonRollover();

    const address = normalizeAddress(input.address);
    const txHash = normalizeTxHash(input.txHash);
    const chainId = input.chainId;

    if (!isEvmAddress(address)) {
      throw new Error('Invalid address');
    }
    if (!isTxHash(txHash)) {
      throw new Error('Invalid txHash');
    }
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new Error('Invalid chainId');
    }

    const usdAmountStr = toDecimal128String(input.usdAmount);
    const usdAmount = Types.Decimal128.fromString(usdAmountStr);

    const unixSeconds =
      typeof input.swapTimestampSec === 'number' &&
      Number.isFinite(input.swapTimestampSec) &&
      input.swapTimestampSec > 0
        ? Math.floor(input.swapTimestampSec)
        : Math.floor(Date.now() / 1000);
    const dayIndex = utcDayIndexFromUnixSeconds(unixSeconds);

    const existing = await this.ledgerModel.findOne({
      sourceType: 'swap',
      sourceId: txHash,
      chainId,
    });
    if (existing) {
      return {
        alreadyAwarded: true,
        ledgerEntryId: existing._id.toString(),
      };
    }

    try {
      // Get or create the per-day streak state (same multiplier for all swaps that day).
      let daily = await this.dailyModel.findOne({ address, dayIndex });
      if (!daily) {
        const prev = await this.dailyModel.findOne({
          address,
          dayIndex: dayIndex - 1,
        });
        const streakDay = prev ? Math.max(1, prev.streakDay + 1) : 1;
        const multiplierBn = multiplierForStreakDay(streakDay);

        try {
          daily = await this.dailyModel.create({
            address,
            dayIndex,
            streakDay,
            multiplier: Types.Decimal128.fromString(multiplierBn.toFixed()),
          });
        } catch (e) {
          // If two requests race, the unique index prevents duplicates.
          const maybeMongo = e as { code?: number };
          if (maybeMongo?.code === 11000) {
            daily = await this.dailyModel.findOne({ address, dayIndex });
          } else {
            throw e;
          }
        }
      }

      const streakDay = daily?.streakDay ?? 1;
      const multiplierStr = daily ? decimalToString(daily.multiplier) : '1';

      const pointsStr = new BigNumber(usdAmountStr)
        .times(new BigNumber(multiplierStr))
        .decimalPlaces(18, BigNumber.ROUND_FLOOR)
        .toFixed();

      const points = Types.Decimal128.fromString(pointsStr);
      const multiplier = Types.Decimal128.fromString(multiplierStr);

      const created = await this.ledgerModel.create({
        address,
        sourceType: 'swap',
        sourceId: txHash,
        chainId,
        usdAmount,
        points,
        multiplier,
        streakDay,
        dayIndex,
        pointsFormulaVersion: 1,
        metadata: {
          ...input.metadata,
          swapTimestampSec: unixSeconds,
        },
      });

      await this.accountModel.updateOne(
        { address },
        {
          $setOnInsert: { address },
          $inc: { swapPoints: points, swapUsdVolume: usdAmount },
          $set: {
            swapStreakDay: streakDay,
            swapMultiplier: multiplier,
            lastSwapDayIndex: dayIndex,
          },
        },
        { upsert: true },
      );

      return {
        alreadyAwarded: false,
        ledgerEntryId: created._id.toString(),
      };
    } catch (e) {
      // If two requests race, the unique index prevents double awards.
      const maybeMongo = e as { code?: number };
      if (maybeMongo?.code === 11000) {
        const entry = await this.ledgerModel.findOne({
          sourceType: 'swap',
          sourceId: txHash,
          chainId,
        });
        return {
          alreadyAwarded: true,
          ledgerEntryId: entry?._id.toString(),
        };
      }
      throw e;
    }
  }
}
