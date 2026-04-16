import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { createPublicClient, http } from 'viem';
import { IndexerState } from './schemas/indexer-state.schema';

type BlockNumberClient = {
  getBlockNumber: () => Promise<bigint>;
};

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private publicClient: BlockNumberClient | null = null;

  constructor(
    @InjectModel(IndexerState.name)
    private readonly indexerStateModel: Model<IndexerState>,
  ) {}

  onModuleInit() {
    // First step: prove we can write + keep a bookmark in Mongo.
    // Later we’ll replace this with "poll chain → decode logs → save".
    this.startHeartbeat();
  }

  onModuleDestroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private startHeartbeat() {
    // Prevent creating duplicate timers during hot-reload.
    if (this.heartbeatTimer) return;

    const chainId = Number(process.env.CHAIN_ID ?? 56); // BSC by default
    const pollMs = Number(process.env.INDEXER_HEARTBEAT_MS ?? 10_000);
    const reorgSafetyBlocks = Number(process.env.REORG_SAFETY_BLOCKS ?? 5);

    this.publicClient = this.buildPublicClient();

    this.logger.log(
      `Indexer heartbeat enabled (chainId=${chainId}, every ${pollMs}ms)`,
    );

    this.heartbeatTimer = setInterval(() => {
      void this.tickHeartbeat(chainId, reorgSafetyBlocks);
    }, pollMs);

    // Run once immediately so we don’t wait for the first interval.
    void this.tickHeartbeat(chainId, reorgSafetyBlocks);
  }

  private buildPublicClient() {
    const explicit = (process.env.RPC_URL ?? '').trim();
    const infuraKey = (process.env.INFURA_API_KEY ?? '').trim();

    const rpcUrl =
      explicit ||
      (infuraKey
        ? // BSC mainnet default. You can override by setting RPC_URL directly.
          `https://bsc-mainnet.infura.io/v3/${infuraKey}`
        : '');

    if (!rpcUrl) {
      this.logger.warn(
        'RPC is not configured. Set RPC_URL or INFURA_API_KEY in .env to enable chain polling.',
      );
    }

    // For basic calls like getBlockNumber, we only need an HTTP transport.
    return createPublicClient({
      transport: http(rpcUrl || 'http://localhost'),
    }) as unknown as BlockNumberClient;
  }

  private async tickHeartbeat(chainId: number, reorgSafetyBlocks: number) {
    try {
      const now = new Date();

      let lastSeenTip: number | null = null;
      let lastFinalizedBlock: number | null = null;

      if (
        this.publicClient &&
        (process.env.RPC_URL || process.env.INFURA_API_KEY)
      ) {
        const tip = await this.publicClient.getBlockNumber();
        lastSeenTip = Number(tip);
        lastFinalizedBlock = Math.max(0, lastSeenTip - reorgSafetyBlocks);
      }

      await this.indexerStateModel.updateOne(
        { chainId },
        {
          $set: {
            chainId,
            lastSeenAt: now,
            ...(lastSeenTip === null ? {} : { lastSeenTip }),
            ...(lastFinalizedBlock === null ? {} : { lastFinalizedBlock }),
          },
        },
        { upsert: true },
      );
      this.logger.debug(
        `Heartbeat saved (chainId=${chainId}, tip=${lastSeenTip ?? 'n/a'}, safe=${lastFinalizedBlock ?? 'n/a'})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Heartbeat failed: ${msg}`);
    }
  }
}
