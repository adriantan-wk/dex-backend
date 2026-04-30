import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import BigNumber from 'bignumber.js';
import { floorTo6DecimalString } from '../common/decimal6';
import {
  utcDayIndexFromUnixSeconds,
  utcMonthIndexFromSeasonKey,
  utcSeasonMonthKeyFromDate,
} from './points-time.config';
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
  PointsPoolProtocol,
} from './schemas/points-ledger-entry.schema';
import {
  PointsSeasonState,
  PointsSeasonStateDocument,
} from './schemas/points-season-state.schema';

type LeaderboardRow = {
  address: string;
  swapPoints: string;
  swapUsdVolume: string;
};
type LeaderboardMy = null | { rank: number | null; row: LeaderboardRow | null };

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function normalizeTxHash(txHash: string): string {
  return txHash.trim().toLowerCase();
}

function isEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isPoolProtocol(p: unknown): p is PointsPoolProtocol {
  return p === 'v2' || p === 'v3';
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

function decimalToStringFloor6(d: Types.Decimal128): string {
  return floorTo6DecimalString(decimalToString(d));
}

function multiplierForStreakDay(streakDay: number): BigNumber {
  const d = Math.max(1, Math.floor(streakDay));
  const m = new BigNumber('1').plus(new BigNumber('0.1').times(d - 1));
  return BigNumber.minimum(m, new BigNumber('2.0'));
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
  ) {}

  onModuleInit() {
    void this.ensureSeasonRollover().catch((e) =>
      this.logger.warn(`Season rollover on boot: ${String(e)}`),
    );
    void this.bestEffortIndexCleanup().catch((e) =>
      this.logger.warn(`Index cleanup on boot: ${String(e)}`),
    );
  }

  private async bestEffortIndexCleanup(): Promise<void> {
    // Mongoose won't drop old indexes automatically. These were previously unique
    // and would prevent per-season rows.
    try {
      await this.accountModel.collection.dropIndex('address_1');
    } catch {
      // ignore (missing index / insufficient permissions)
    }
    try {
      await this.dailyModel.collection.dropIndex('uniq_address_day');
    } catch {
      // ignore (missing index / insufficient permissions)
    }
  }

  private async getOrInitSeasonStateRow(): Promise<PointsSeasonStateDocument> {
    const targetMonthKey = utcSeasonMonthKeyFromDate(new Date());
    await this.seasonStateModel.updateOne(
      {},
      {
        $setOnInsert: {
          activeSeasonId: 1,
          activeSeasonMonthKey: targetMonthKey,
        },
      },
      { upsert: true },
    );
    const row = await this.seasonStateModel.findOne({});
    if (!row) {
      throw new Error('points season state unavailable');
    }
    if (
      typeof row.activeSeasonId !== 'number' ||
      !Number.isFinite(row.activeSeasonId) ||
      typeof row.activeSeasonMonthKey !== 'string' ||
      !row.activeSeasonMonthKey
    ) {
      throw new Error('points season state invalid');
    }
    return row;
  }

  /**
   * When UTC month advances, move `activeSeasonId` forward (possibly across
   * multiple months if the process was idle).
   */
  async ensureSeasonRollover(): Promise<void> {
    const targetMonthKey = utcSeasonMonthKeyFromDate(new Date());
    const targetIdx = utcMonthIndexFromSeasonKey(targetMonthKey);
    if (targetIdx === null) return;

    // Avoid iterating one month at a time (tight loop + many `findOneAndUpdate` calls).
    // Advance by the full month delta in a single atomic update when keys are valid.
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const row = await this.getOrInitSeasonStateRow();

      const currentIdx = utcMonthIndexFromSeasonKey(row.activeSeasonMonthKey);
      if (currentIdx === null) {
        throw new Error(
          `points season state: activeSeasonMonthKey must be YYYY-MM, got ${JSON.stringify(row.activeSeasonMonthKey)}`,
        );
      }

      if (currentIdx >= targetIdx) return;

      const delta = targetIdx - currentIdx;
      const advanced = await this.seasonStateModel.findOneAndUpdate(
        {
          activeSeasonId: row.activeSeasonId,
          activeSeasonMonthKey: row.activeSeasonMonthKey,
        },
        {
          $set: { activeSeasonMonthKey: targetMonthKey },
          $inc: { activeSeasonId: delta },
        },
        { returnDocument: 'after' },
      );

      if (advanced) return;
    }
  }

  async getActiveSeasonId(): Promise<number> {
    const row = await this.getOrInitSeasonStateRow();
    return row.activeSeasonId;
  }

  async listSeasons(): Promise<{ seasons: number[]; activeSeasonId: number }> {
    await this.ensureSeasonRollover();
    const activeSeasonId = await this.getActiveSeasonId();

    const distinct = await this.accountModel.distinct('seasonId');
    const seasons = [
      ...new Set<number>(
        distinct.filter(
          (s): s is number => typeof s === 'number' && Number.isFinite(s),
        ),
      ),
    ].sort((a, b) => b - a);

    if (!seasons.includes(activeSeasonId)) seasons.unshift(activeSeasonId);
    return { seasons, activeSeasonId };
  }

  async getAccount(address: string, seasonParam?: string) {
    await this.ensureSeasonRollover();

    const normalized = normalizeAddress(address);
    const activeSeasonId = await this.getActiveSeasonId();
    const requested =
      typeof seasonParam === 'string' && seasonParam.trim() !== ''
        ? Number(seasonParam)
        : NaN;
    const seasonId =
      Number.isFinite(requested) && requested > 0
        ? Math.floor(requested)
        : activeSeasonId;

    const account = await this.accountModel.findOne({
      address: normalized,
      seasonId,
    });
    if (!account) {
      return {
        address: normalized,
        seasonId,
        swapPoints: '0',
        swapUsdVolume: '0',
        swapStreakDay: 0,
        swapMultiplier: '1',
        lastSwapDayIndex: null,
      };
    }
    return {
      address: account.address,
      seasonId: account.seasonId,
      swapPoints: decimalToStringFloor6(account.swapPoints),
      swapUsdVolume: decimalToStringFloor6(account.swapUsdVolume),
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
      poolProtocol: e.poolProtocol,
      chainId: e.chainId,
      usdAmount: decimalToStringFloor6(e.usdAmount),
      points: decimalToStringFloor6(e.points),
      multiplier: decimalToString(e.multiplier),
      pointsFormulaVersion: e.pointsFormulaVersion,
      createdAt: (
        e as unknown as { createdAt?: Date }
      ).createdAt?.toISOString(),
      metadata: e.metadata ?? undefined,
    }));
  }

  async getLeaderboard(
    limit: number,
    seasonParam?: string,
    addressParam?: string,
    pageParam?: number,
  ) {
    await this.ensureSeasonRollover();

    const activeSeasonId = await this.getActiveSeasonId();
    const requestedRaw =
      typeof seasonParam === 'string' && seasonParam.trim() !== ''
        ? Number(seasonParam)
        : NaN;
    const requestedSeasonId =
      Number.isFinite(requestedRaw) && requestedRaw > 0
        ? Math.floor(requestedRaw)
        : undefined;

    const seasonId = requestedSeasonId ?? activeSeasonId;

    if (requestedSeasonId && requestedSeasonId > activeSeasonId) {
      return {
        seasonId,
        activeSeasonId,
        isHistorical: false,
        page: 1,
        pageSize: 10,
        totalPages: 1,
        entries: [] as LeaderboardRow[],
        my: null as LeaderboardMy,
      };
    }

    const pageSize = 10;
    const totalEntries = await this.accountModel.countDocuments({ seasonId });
    const totalPages = Math.max(
      1,
      Math.min(10, Math.ceil(totalEntries / pageSize)),
    );
    const pageRaw = typeof pageParam === 'number' ? pageParam : 1;
    const page = Math.max(1, Math.min(Math.floor(pageRaw), totalPages));

    // Backwards-compatible: keep accepting limit, but never exceed page size.
    const n = Math.max(1, Math.min(limit || pageSize, pageSize));
    const skip = (page - 1) * pageSize;
    const rows = await this.accountModel
      .find({ seasonId })
      .sort({ swapPoints: -1, swapUsdVolume: -1, address: 1 })
      .skip(skip)
      .limit(n);

    const normalizedAddr =
      typeof addressParam === 'string' && isEvmAddress(addressParam.trim())
        ? normalizeAddress(addressParam)
        : null;

    let my: LeaderboardMy = null;

    if (normalizedAddr) {
      const mine = await this.accountModel
        .findOne({ address: normalizedAddr, seasonId })
        .lean();

      if (!mine) {
        my = { rank: null, row: null };
      } else {
        const myPoints = mine.swapPoints;
        const myVol = mine.swapUsdVolume;

        const ahead = await this.accountModel.countDocuments({
          seasonId,
          $or: [
            { swapPoints: { $gt: myPoints } },
            { swapPoints: myPoints, swapUsdVolume: { $gt: myVol } },
            {
              swapPoints: myPoints,
              swapUsdVolume: myVol,
              address: { $lt: mine.address },
            },
          ],
        });

        my = {
          rank: ahead + 1,
          row: {
            address: mine.address,
            swapPoints: decimalToStringFloor6(mine.swapPoints),
            swapUsdVolume: decimalToStringFloor6(mine.swapUsdVolume),
          },
        };
      }
    }

    return {
      seasonId,
      activeSeasonId,
      isHistorical: Boolean(
        requestedSeasonId && requestedSeasonId !== activeSeasonId,
      ),
      page,
      pageSize,
      totalPages,
      entries: rows.map((r) => ({
        address: r.address,
        swapPoints: decimalToStringFloor6(r.swapPoints),
        swapUsdVolume: decimalToStringFloor6(r.swapUsdVolume),
      })),
      my,
    };
  }

  /**
   * Award points for a subgraph-indexed swap (`sourceSwapId` = `Swap.id`, not raw tx hash).
   * Avoids collapsing multiple swaps in one transaction into a single ledger row.
   */
  async awardPointsFromSwap(input: {
    address: string;
    sourceSwapId: string;
    poolProtocol: PointsPoolProtocol;
    chainId: number;
    usdAmount: string;
    swapTimestampSec: number;
    metadata?: Record<string, unknown>;
  }) {
    return this.awardSwapInternal({
      address: input.address,
      sourceId: input.sourceSwapId,
      poolProtocol: input.poolProtocol,
      chainId: input.chainId,
      usdAmount: input.usdAmount,
      swapTimestampSec: input.swapTimestampSec,
      metadata: input.metadata,
    });
  }

  private async awardSwapInternal(input: {
    address: string;
    sourceId: string;
    poolProtocol: PointsPoolProtocol;
    chainId: number;
    usdAmount: string;
    swapTimestampSec?: number;
    metadata?: Record<string, unknown>;
  }) {
    await this.ensureSeasonRollover();

    const address = normalizeAddress(input.address);
    const sourceId = normalizeTxHash(input.sourceId);
    const chainId = input.chainId;

    if (!isEvmAddress(address)) {
      throw new Error('Invalid address');
    }
    if (!sourceId) {
      throw new Error('Invalid sourceId');
    }
    if (!isPoolProtocol(input.poolProtocol)) {
      throw new Error('Invalid poolProtocol');
    }
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new Error('Invalid chainId');
    }

    const usdAmountStr = floorTo6DecimalString(
      toDecimal128String(input.usdAmount),
    );
    const usdAmount = Types.Decimal128.fromString(usdAmountStr);

    const unixSeconds =
      typeof input.swapTimestampSec === 'number' &&
      Number.isFinite(input.swapTimestampSec) &&
      input.swapTimestampSec > 0
        ? Math.floor(input.swapTimestampSec)
        : Math.floor(Date.now() / 1000);
    const dayIndex = utcDayIndexFromUnixSeconds(unixSeconds);
    const seasonId = await this.getActiveSeasonId();

    const existing = await this.ledgerModel.findOne({
      sourceType: 'swap',
      sourceId,
      chainId,
    });
    if (existing) {
      return {
        alreadyAwarded: true,
        ledgerEntryId: existing._id.toString(),
        seasonId,
      };
    }

    try {
      // Get or create the per-day streak state (same multiplier for all swaps that day).
      let daily = await this.dailyModel.findOne({
        address,
        seasonId,
        dayIndex,
      });
      if (!daily) {
        const prev = await this.dailyModel.findOne({
          address,
          seasonId,
          dayIndex: dayIndex - 1,
        });
        const streakDay = prev ? Math.max(1, prev.streakDay + 1) : 1;
        const multiplierBn = multiplierForStreakDay(streakDay);

        try {
          daily = await this.dailyModel.create({
            address,
            seasonId,
            dayIndex,
            streakDay,
            multiplier: Types.Decimal128.fromString(multiplierBn.toFixed()),
          });
        } catch (e) {
          // If two requests race, the unique index prevents duplicates.
          const maybeMongo = e as unknown as { code?: number };
          if (maybeMongo?.code === 11000) {
            daily = await this.dailyModel.findOne({
              address,
              seasonId,
              dayIndex,
            });
          } else {
            throw e;
          }
        }
      }

      const streakDay = daily?.streakDay ?? 1;
      const multiplierStr = daily ? decimalToString(daily.multiplier) : '1';

      const pointsStr = floorTo6DecimalString(
        new BigNumber(usdAmountStr).times(new BigNumber(multiplierStr)),
      );

      const points = Types.Decimal128.fromString(pointsStr);
      const multiplier = Types.Decimal128.fromString(multiplierStr);

      const account = await this.accountModel.findOneAndUpdate(
        { address, seasonId },
        {
          $setOnInsert: {
            address,
            seasonId,
          },
          $inc: { swapPoints: points, swapUsdVolume: usdAmount },
          $set: {
            swapStreakDay: streakDay,
            swapMultiplier: multiplier,
            lastSwapDayIndex: dayIndex,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
      if (!account) {
        throw new Error('Failed to upsert points account');
      }

      const created = (await this.ledgerModel.create({
        address,
        seasonId,
        pointsAccountId: account._id as unknown as Types.ObjectId,
        sourceType: 'swap',
        sourceId,
        poolProtocol: input.poolProtocol,
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
      })) as PointsLedgerEntryDocument;

      return {
        alreadyAwarded: false,
        ledgerEntryId: created._id.toString(),
        seasonId,
        address,
        usdAmount: usdAmountStr,
        points: pointsStr,
        multiplier: multiplierStr,
        streakDay,
        dayIndex,
      };
    } catch (e) {
      // If two requests race, the unique index prevents double awards.
      const maybeMongo = e as unknown as { code?: number };
      if (maybeMongo?.code === 11000) {
        const entry = await this.ledgerModel.findOne({
          sourceType: 'swap',
          sourceId,
          chainId,
        });
        if (!entry) {
          throw new Error('Duplicate award detected but ledger entry missing');
        }
        return {
          alreadyAwarded: true,
          ledgerEntryId: entry._id.toString(),
          seasonId,
        };
      }
      throw e;
    }
  }
}
