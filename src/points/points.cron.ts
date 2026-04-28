import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PointsService } from './points.service';
import {
  PointsIndexerState,
  PointsIndexerStateDocument,
} from './schemas/points-indexer-state.schema';
import { fetchSubgraphSwaps } from './points.subgraph';

@Injectable()
export class PointsCron implements OnModuleInit {
  private readonly logger = new Logger(PointsCron.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly points: PointsService,
    @InjectModel(PointsIndexerState.name)
    private readonly indexerModel: Model<PointsIndexerStateDocument>,
  ) {}

  onModuleInit() {
    this.logger.log('Points cron initialized');
    void this.runSync('startup');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async syncSwapPointsHourly(): Promise<void> {
    await this.runSync('hourly');
  }

  private async runSync(trigger: 'startup' | 'hourly'): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      this.logger.log(`Points sync started (${trigger})`);
      const urlV2 = this.config.get<string>('POINTS_SUBGRAPH_URL_V2')?.trim();
      const urlV3 = this.config.get<string>('POINTS_SUBGRAPH_URL_V3')?.trim();
      const sources = [
        { key: 'v2', url: urlV2 },
        { key: 'v3', url: urlV3 },
      ].filter((s): s is { key: 'v2' | 'v3'; url: string } => Boolean(s.url));

      if (sources.length === 0) {
        this.logger.warn(
          'POINTS_SUBGRAPH_URL_V2/POINTS_SUBGRAPH_URL_V3 not set; skipping points sync',
        );
        return;
      }

      const chainIdRaw = this.config.get<string>('POINTS_CHAIN_ID')?.trim();
      const chainId = chainIdRaw ? Number(chainIdRaw) : 56;
      if (!Number.isInteger(chainId) || chainId <= 0) {
        this.logger.warn(
          `Invalid POINTS_CHAIN_ID=${JSON.stringify(chainIdRaw)}; skipping points sync`,
        );
        return;
      }

      const pageSize = 500;
      const maxPages = 100; // hard cap to avoid runaway loops

      for (const source of sources) {
        const state = await this.getOrInitState(source.key);

        let cursorTs = state.lastProcessedTimestampSec;
        let cursorId = state.lastProcessedSwapId;

        let totalProcessed = 0;

        for (let page = 0; page < maxPages; page++) {
          const swaps = await fetchSubgraphSwaps({
            url: source.url,
            source: source.key,
            first: pageSize,
            lastTimestampSec: cursorTs,
            lastSwapId: cursorId,
          });

          if (swaps.length === 0) break;

          for (const s of swaps) {
            const ts = Number(s.timestamp);
            if (!Number.isFinite(ts) || ts <= 0) continue;

            const address = String(s.origin ?? s.from ?? s.sender ?? '').trim();
            if (!address) continue;

            const usdAmount = String(s.amountUSD ?? '').trim();
            if (!usdAmount) continue;

            const res = await this.points.awardPointsFromSubgraphSwap({
              address,
              chainId,
              sourceSwapId: `${source.key}:${s.id}`,
              usdAmount,
              swapTimestampSec: Math.floor(ts),
              metadata: {
                subgraphSource: source.key,
                subgraphSwapId: s.id,
              },
            });
            if (res && typeof res === 'object' && !('alreadyAwarded' in res)) {
              // no-op (type guard)
            }
            if (res?.alreadyAwarded === false) {
              this.logger.log(
                `Awarded ${res.points} pts (usd=${res.usdAmount}, mult=${res.multiplier}) to ${res.address} season=${res.seasonId} source=${source.key}:${s.id}`,
              );
            }

            cursorTs = Math.floor(ts);
            cursorId = s.id;
            totalProcessed++;

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

        if (totalProcessed > 0) {
          this.logger.log(
            `Points sync (${source.key}) processed ${totalProcessed} swaps`,
          );
        }
      }
    } catch (e) {
      this.logger.error(`Points sync failed: ${String(e)}`);
    } finally {
      this.running = false;
    }
  }

  private async getOrInitState(
    id: 'v2' | 'v3',
  ): Promise<PointsIndexerStateDocument> {
    await this.indexerModel.updateOne(
      { _id: id },
      { $setOnInsert: { _id: id } },
      { upsert: true },
    );
    const row = await this.indexerModel.findOne({ _id: id });
    if (!row) throw new Error('points indexer state unavailable');
    return row;
  }
}
