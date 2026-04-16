import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Swap } from './schemas/swap.schema';

@Controller('monitoring')
export class MonitoringController {
  constructor(
    @InjectModel(Swap.name)
    private readonly swapModel: Model<Swap>,
  ) {}

  @Get('swaps')
  async listSwaps(
    @Query('chainId') chainIdRaw?: string,
    @Query('poolAddress') poolAddress?: string,
    @Query('token') token?: string,
    @Query('minUsd') minUsd?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const chainId = Number(chainIdRaw ?? 56);
    const limit = Math.min(Math.max(Number(limitRaw ?? 25), 1), 200);

    const filter: Record<string, unknown> = { chainId };

    if (poolAddress?.trim()) {
      filter.poolAddress = poolAddress.trim().toLowerCase();
    }

    if (token?.trim()) {
      const t = token.trim().toLowerCase();
      filter.$or = [{ tokenIn: t }, { tokenOut: t }];
    }

    if (minUsd?.trim() && /^[0-9]+(\.[0-9]+)?$/.test(minUsd.trim())) {
      // Stored as a numeric-string, so this is lexicographic. Keep it optional until you switch to Decimal128.
      filter.amountUsd = { $gte: minUsd.trim() };
    }

    const rows = await this.swapModel
      .find(filter, {
        _id: 0,
        chainId: 1,
        blockNumber: 1,
        txHash: 1,
        logIndex: 1,
        poolAddress: 1,
        protocol: 1,
        timestamp: 1,
        tokenIn: 1,
        tokenOut: 1,
        amountInRaw: 1,
        amountOutRaw: 1,
        amountUsd: 1,
        sender: 1,
        recipient: 1,
      })
      .sort({ blockNumber: -1, logIndex: -1 })
      .limit(limit)
      .lean();

    return { items: rows };
  }
}

