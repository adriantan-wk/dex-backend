import { Injectable } from '@nestjs/common';
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

@Injectable()
export class PointsService {
  constructor(
    @InjectModel(PointsAccount.name)
    private readonly accountModel: Model<PointsAccountDocument>,
    @InjectModel(PointsDaily.name)
    private readonly dailyModel: Model<PointsDailyDocument>,
    @InjectModel(PointsLedgerEntry.name)
    private readonly ledgerModel: Model<PointsLedgerEntryDocument>,
  ) {}

  async getAccount(address: string) {
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

  async getLeaderboard(limit: number) {
    const n = Math.max(1, Math.min(limit || 50, 200));
    const rows = await this.accountModel
      .find({})
      .sort({ swapPoints: -1 })
      .limit(n);

    return rows.map((r) => ({
      address: r.address,
      swapPoints: decimalToString(r.swapPoints),
      swapUsdVolume: decimalToString(r.swapUsdVolume),
    }));
  }

  async awardPointsFromSwap(input: {
    address: string;
    txHash: string;
    chainId: number;
    usdAmount: string;
    swapTimestampSec?: number;
    metadata?: Record<string, unknown>;
  }) {
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
