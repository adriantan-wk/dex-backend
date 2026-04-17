import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  createPublicClient,
  decodeEventLog,
  getEventSelector,
  http,
  parseAbiItem,
} from 'viem';
import { bsc, bscTestnet } from 'viem/chains';
import { DexEvent } from './schemas/dex-event.schema';
import { IndexerState } from './schemas/indexer-state.schema';
import { PoolWatch } from './schemas/pool-watch.schema';
import type { DexProtocol } from './schemas/swap.schema';
import { Swap } from './schemas/swap.schema';
import {
  asAddress,
  asBigintString,
  asSignedBigintString,
  parseSignedBigint,
} from './utils/coerce';

const v2SwapEvent = parseAbiItem(
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
);

const v3SwapEvent = parseAbiItem(
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
);

const v2SwapTopic = getEventSelector(v2SwapEvent);
const v3SwapTopic = getEventSelector(v3SwapEvent);

const token0Fn = parseAbiItem('function token0() view returns (address)');
const token1Fn = parseAbiItem('function token1() view returns (address)');
const feeFn = parseAbiItem('function fee() view returns (uint24)');

type RawSwapLog = {
  address: string;
  blockNumber: bigint;
  data: `0x${string}`;
  logIndex: number | bigint;
  topics: readonly `0x${string}`[];
  transactionHash: `0x${string}`;
};

function isRawSwapLog(v: unknown): v is RawSwapLog {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<RawSwapLog>;
  return (
    typeof r.address === 'string' &&
    typeof r.transactionHash === 'string' &&
    typeof r.data === 'string' &&
    typeof r.blockNumber === 'bigint' &&
    (typeof r.logIndex === 'bigint' || typeof r.logIndex === 'number') &&
    Array.isArray(r.topics) &&
    r.topics.every((t) => typeof t === 'string')
  );
}

type PublicClientLike = {
  getBlockNumber: () => Promise<bigint>;
  getLogs: (args: Record<string, unknown>) => Promise<unknown[]>;
  getBlock: (args: Record<string, unknown>) => Promise<{ timestamp: bigint }>;
  multicall: (
    args: Record<string, unknown>,
  ) => Promise<Array<{ result?: unknown }>>;
};

type DexEventInput = {
  chainId: number;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  address: string;
  eventType: string;
  data: Record<string, unknown>;
};

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private publicClient: PublicClientLike | null = null;
  private isTickRunning = false;

  constructor(
    @InjectModel(IndexerState.name)
    private readonly indexerStateModel: Model<IndexerState>,
    @InjectModel(PoolWatch.name)
    private readonly poolWatchModel: Model<PoolWatch>,
    @InjectModel(DexEvent.name)
    private readonly dexEventModel: Model<DexEvent>,
    @InjectModel(Swap.name)
    private readonly swapModel: Model<Swap>,
  ) {}

  onModuleInit() {
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
    const pollMs = Number(process.env.INDEXER_POLL_MS ?? 10_000);
    const reorgSafetyBlocks = Number(process.env.REORG_SAFETY_BLOCKS ?? 5);
    const batchBlocks = Number(process.env.INDEXER_BATCH_BLOCKS ?? 2_000);

    this.publicClient = this.buildPublicClient();

    this.logger.log(
      `Indexer enabled (chainId=${chainId}, every ${pollMs}ms, batch=${batchBlocks} blocks)`,
    );

    this.heartbeatTimer = setInterval(() => {
      void this.tick(chainId, reorgSafetyBlocks, batchBlocks);
    }, pollMs);

    // Run once immediately so we don’t wait for the first interval.
    void this.tick(chainId, reorgSafetyBlocks, batchBlocks);
  }

  private buildPublicClient() {
    const explicit = (process.env.RPC_URL ?? '').trim();
    const infuraKey = (process.env.INFURA_API_KEY ?? '').trim();
    const chainId = Number(process.env.CHAIN_ID ?? 56);

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

    const chain = chainId === bscTestnet.id ? bscTestnet : bsc;

    return createPublicClient({
      chain,
      transport: http(rpcUrl || 'http://localhost'),
    }) as unknown as PublicClientLike;
  }

  private async tick(
    chainId: number,
    reorgSafetyBlocks: number,
    batchBlocks: number,
  ) {
    if (this.isTickRunning) return;
    this.isTickRunning = true;
    try {
      const now = new Date();

      let lastSeenTip: number | null = null;
      let lastFinalizedBlock: number | null = null;

      if (this.publicClient) {
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

      if (lastFinalizedBlock !== null && this.publicClient) {
        await this.indexSwapLogsUpTo(chainId, lastFinalizedBlock, batchBlocks);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Indexer tick failed: ${msg}`);
    } finally {
      this.isTickRunning = false;
    }
  }

  private async indexSwapLogsUpTo(
    chainId: number,
    safeTip: number,
    batchBlocks: number,
  ) {
    const startBlockEnv = (process.env.INDEXER_START_BLOCK ?? '').trim();
    const startBlock = startBlockEnv ? Number(startBlockEnv) : null;

    const state = (await this.indexerStateModel
      .findOne({ chainId }, { _id: 0, lastIndexedBlock: 1 })
      .lean()) as { lastIndexedBlock?: number | null } | null;

    const lastIndexedRaw = state?.lastIndexedBlock ?? null;
    const lastIndexed =
      typeof lastIndexedRaw === 'number' && Number.isFinite(lastIndexedRaw)
        ? lastIndexedRaw
        : null;

    const fromBlock =
      lastIndexed !== null
        ? lastIndexed + 1
        : startBlock !== null && Number.isFinite(startBlock)
          ? Math.max(0, startBlock)
          : safeTip;

    if (fromBlock > safeTip) return;

    const toBlock = Math.min(fromBlock + Math.max(1, batchBlocks) - 1, safeTip);

    const watched = await this.poolWatchModel
      .find({ chainId }, { _id: 0, poolAddress: 1 })
      .lean();

    const addresses = watched
      .map((r) =>
        typeof r.poolAddress === 'string' ? r.poolAddress.trim() : '',
      )
      .filter(Boolean)
      .map((a) => a.toLowerCase());

    if (addresses.length === 0) {
      // Nothing to index without a watchlist.
      await this.indexerStateModel.updateOne(
        { chainId },
        { $set: { lastIndexedBlock: toBlock } },
        { upsert: true },
      );
      return;
    }

    const logs = await this.fetchSwapLogs(addresses, fromBlock, toBlock);
    if (logs.length > 0) {
      await this.ingestSwapLogs(chainId, logs);
    }

    await this.indexerStateModel.updateOne(
      { chainId },
      { $set: { lastIndexedBlock: toBlock } },
      { upsert: true },
    );

    this.logger.debug(
      `Indexed blocks [${fromBlock}, ${toBlock}] swaps=${logs.length} watchedPools=${addresses.length}`,
    );
  }

  private async fetchSwapLogs(
    lowercasedAddresses: string[],
    fromBlock: number,
    toBlock: number,
  ) {
    if (!this.publicClient) return [];

    // Many RPCs have limits on how many addresses you can query at once.
    const chunkSize = Number(process.env.INDEXER_ADDRESS_CHUNK ?? 50);
    const topics = [[v2SwapTopic, v3SwapTopic]];

    const out: RawSwapLog[] = [];
    for (let i = 0; i < lowercasedAddresses.length; i += chunkSize) {
      const chunk = lowercasedAddresses.slice(i, i + chunkSize);
      const rows = await this.publicClient.getLogs({
        address: chunk as any,
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock),
        topics,
      });

      for (const row of rows) {
        if (isRawSwapLog(row)) out.push(row);
      }
    }
    return out;
  }

  private async ingestSwapLogs(chainId: number, logs: RawSwapLog[]) {
    if (!this.publicClient) return;

    const blocks = new Set<number>();
    const poolKeys = new Set<string>();
    const v3Pools = new Set<string>();

    for (const log of logs) {
      blocks.add(Number(log.blockNumber));
      const key = log.address.toLowerCase();
      poolKeys.add(key);
      if (log.topics[0] === v3SwapTopic) v3Pools.add(key);
    }

    const timestamps = new Map<number, number>();
    for (const b of blocks) {
      try {
        const blk = await this.publicClient.getBlock({
          blockNumber: BigInt(b),
        });
        timestamps.set(b, Number(blk.timestamp));
      } catch {
        // optional
      }
    }

    const pools = [...poolKeys];
    const contracts: Array<{
      address: `0x${string}`;
      abi: any;
      functionName: 'token0' | 'token1' | 'fee';
    }> = [];

    for (const key of pools) {
      const addr = key as `0x${string}`;
      contracts.push({
        address: addr,
        abi: [token0Fn],
        functionName: 'token0',
      });
      contracts.push({
        address: addr,
        abi: [token1Fn],
        functionName: 'token1',
      });
      if (v3Pools.has(key)) {
        contracts.push({ address: addr, abi: [feeFn], functionName: 'fee' });
      }
    }

    const results =
      contracts.length > 0
        ? await this.publicClient.multicall({ contracts, allowFailure: true })
        : [];

    const meta = new Map<
      string,
      { token0?: string; token1?: string; fee?: number }
    >();
    let idx = 0;
    for (const key of pools) {
      const t0 = results[idx++]?.result;
      const t1 = results[idx++]?.result;
      const entry: { token0?: string; token1?: string; fee?: number } = {};
      if (typeof t0 === 'string') entry.token0 = t0;
      if (typeof t1 === 'string') entry.token1 = t1;
      if (v3Pools.has(key)) {
        const feeRaw = results[idx++]?.result;
        if (typeof feeRaw === 'bigint') entry.fee = Number(feeRaw);
        if (typeof feeRaw === 'number' && Number.isFinite(feeRaw))
          entry.fee = feeRaw;
      }
      meta.set(key, entry);
    }

    type DecodedV2Args = {
      sender: `0x${string}`;
      to: `0x${string}`;
      amount0In: bigint;
      amount1In: bigint;
      amount0Out: bigint;
      amount1Out: bigint;
    };

    type DecodedV3Args = {
      sender: `0x${string}`;
      recipient: `0x${string}`;
      amount0: bigint;
      amount1: bigint;
      sqrtPriceX96: bigint;
      liquidity: bigint;
      tick: number;
    };

    for (const log of logs) {
      const address = log.address;
      const poolKey = address.toLowerCase();
      const m = meta.get(poolKey) ?? {};

      const topicsForDecode =
        log.topics.length > 0
          ? (Array.from(log.topics) as [
              signature: `0x${string}`,
              ...args: `0x${string}`[],
            ])
          : ([] as []);

      let decoded:
        | { kind: 'v2'; args: DecodedV2Args }
        | { kind: 'v3'; args: DecodedV3Args }
        | null = null;
      try {
        const d = decodeEventLog({
          abi: [v2SwapEvent],
          data: log.data,
          topics: topicsForDecode,
        });
        decoded = { kind: 'v2', args: d.args as unknown as DecodedV2Args };
      } catch {
        // not v2
      }

      if (!decoded) {
        try {
          const d = decodeEventLog({
            abi: [v3SwapEvent],
            data: log.data,
            topics: topicsForDecode,
          });
          decoded = { kind: 'v3', args: d.args as unknown as DecodedV3Args };
        } catch {
          // not v3
        }
      }

      if (!decoded) continue;

      const blockNumber = Number(log.blockNumber);
      const logIndex = Number(log.logIndex);
      const txHash = log.transactionHash;

      const timestamp = timestamps.get(blockNumber);

      const data: Record<string, unknown> =
        decoded.kind === 'v2'
          ? {
              sender: decoded.args.sender,
              to: decoded.args.to,
              amount0In: decoded.args.amount0In.toString(),
              amount1In: decoded.args.amount1In.toString(),
              amount0Out: decoded.args.amount0Out.toString(),
              amount1Out: decoded.args.amount1Out.toString(),
            }
          : {
              sender: decoded.args.sender,
              recipient: decoded.args.recipient,
              amount0: decoded.args.amount0.toString(),
              amount1: decoded.args.amount1.toString(),
              sqrtPriceX96: decoded.args.sqrtPriceX96.toString(),
              liquidity: decoded.args.liquidity.toString(),
              tick: Number(decoded.args.tick),
            };

      if (m.token0) data.token0 = m.token0;
      if (m.token1) data.token1 = m.token1;
      if (m.fee !== undefined) data.fee = m.fee;
      if (timestamp !== undefined) data.timestamp = timestamp;

      await this.ingestDexEvent({
        chainId,
        blockNumber,
        logIndex,
        txHash,
        address,
        eventType: 'Swap',
        data,
      });
    }
  }

  /**
   * Entry point for your future on-chain polling/decoding loop.
   * - Upserts the raw `dex_events` record (append-only semantics via unique index)
   * - If the event is a Swap, materializes a normalized row in `swaps`
   */
  async ingestDexEvent(evt: DexEventInput) {
    // 1) Raw log (canonical)
    await this.dexEventModel.updateOne(
      {
        chainId: evt.chainId,
        blockNumber: evt.blockNumber,
        logIndex: evt.logIndex,
      },
      {
        $setOnInsert: {
          chainId: evt.chainId,
          blockNumber: evt.blockNumber,
          logIndex: evt.logIndex,
          txHash: evt.txHash,
          address: evt.address,
          eventType: evt.eventType,
          data: evt.data,
        },
      },
      { upsert: true },
    );

    // 2) Derived swaps
    if (evt.eventType === 'Swap') {
      const normalized = this.normalizeSwap(evt);
      if (!normalized) return;

      await this.swapModel.updateOne(
        {
          chainId: normalized.chainId,
          txHash: normalized.txHash,
          logIndex: normalized.logIndex,
        },
        { $set: normalized },
        { upsert: true },
      );
    }
  }

  private normalizeSwap(evt: DexEventInput): Partial<Swap> | null {
    const data = evt.data ?? {};

    // Common optional enrichments
    const timestamp =
      typeof data.timestamp === 'number'
        ? new Date(data.timestamp * 1000)
        : data.timestamp instanceof Date
          ? data.timestamp
          : null;

    // Heuristics: V3 swaps usually include sqrtPriceX96 + tick.
    const protocol: DexProtocol =
      typeof data.sqrtPriceX96 === 'string' || typeof data.tick === 'number'
        ? 'v3'
        : 'v2';

    // V2 shape (UniswapV2/PancakeV2): amount0In/amount1In/amount0Out/amount1Out (+ sometimes sender/to)
    const v2amount0In = asBigintString(data.amount0In);
    const v2amount1In = asBigintString(data.amount1In);
    const v2amount0Out = asBigintString(data.amount0Out);
    const v2amount1Out = asBigintString(data.amount1Out);

    // V3 shape (UniswapV3): amount0/amount1 signed (+ sender/recipient + sqrtPriceX96/liquidity/tick)
    const v3amount0 = asSignedBigintString(data.amount0);
    const v3amount1 = asSignedBigintString(data.amount1);

    // We can compute tokenIn/tokenOut only if token0/token1 are known.
    const token0 = asAddress(data.token0);
    const token1 = asAddress(data.token1);

    let tokenIn: string | null = null;
    let tokenOut: string | null = null;
    let amountInRaw: string | null = null;
    let amountOutRaw: string | null = null;

    if (protocol === 'v2' && token0 && token1) {
      // Determine direction by which side had input.
      // If amount0In > 0 => token0 in, token1 out (amount1Out)
      // If amount1In > 0 => token1 in, token0 out (amount0Out)
      if (v2amount0In && v2amount0In !== '0') {
        tokenIn = token0;
        tokenOut = token1;
        amountInRaw = v2amount0In;
        amountOutRaw = v2amount1Out ?? null;
      } else if (v2amount1In && v2amount1In !== '0') {
        tokenIn = token1;
        tokenOut = token0;
        amountInRaw = v2amount1In;
        amountOutRaw = v2amount0Out ?? null;
      }
    }

    if (protocol === 'v3' && token0 && token1) {
      // V3 event uses signed deltas from pool perspective:
      // amount0 > 0 => pool received token0 (trader token0 in)
      // amount0 < 0 => pool sent token0 (trader token0 out)
      const a0 = parseSignedBigint(v3amount0);
      const a1 = parseSignedBigint(v3amount1);
      if (a0 !== null && a1 !== null) {
        if (a0 > 0n && a1 < 0n) {
          tokenIn = token0;
          tokenOut = token1;
          amountInRaw = a0.toString();
          amountOutRaw = (-a1).toString();
        } else if (a1 > 0n && a0 < 0n) {
          tokenIn = token1;
          tokenOut = token0;
          amountInRaw = a1.toString();
          amountOutRaw = (-a0).toString();
        }
      }
    }

    // If we can’t normalize direction yet, still store a row (pool/tx identity),
    // so you can backfill once token0/token1 enrichment is added.
    const sender = asAddress(data.sender);
    const recipient = asAddress(data.recipient ?? data.to);

    return {
      chainId: evt.chainId,
      blockNumber: evt.blockNumber,
      txHash: evt.txHash,
      logIndex: evt.logIndex,
      poolAddress: asAddress(evt.address) ?? evt.address,
      protocol,
      timestamp,
      tokenIn,
      tokenOut,
      amountInRaw,
      amountOutRaw,
      amountUsd: typeof data.amountUsd === 'string' ? data.amountUsd : null,
      sender,
      recipient,
      sqrtPriceX96:
        typeof data.sqrtPriceX96 === 'string' ? data.sqrtPriceX96 : null,
      tick: typeof data.tick === 'number' ? data.tick : null,
      liquidity: typeof data.liquidity === 'string' ? data.liquidity : null,
      fee: typeof data.fee === 'number' ? data.fee : null,
    };
  }
}
