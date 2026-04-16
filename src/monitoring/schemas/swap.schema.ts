import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type SwapDocument = HydratedDocument<Swap>;

export type DexProtocol = 'v2' | 'v3';

@Schema({
  collection: 'swaps',
  timestamps: { createdAt: true, updatedAt: true },
})
export class Swap {
  // Canonical identity (points back to the raw log)
  @Prop({ required: true, index: true })
  chainId: number;

  @Prop({ required: true, index: true })
  blockNumber: number;

  @Prop({ required: true, index: true })
  txHash: string;

  @Prop({ required: true, index: true })
  logIndex: number;

  @Prop({ required: true, index: true })
  poolAddress: string;

  @Prop({ required: true, index: true, enum: ['v2', 'v3'] })
  protocol: DexProtocol;

  // Optional until you enrich with block timestamp during ingestion.
  @Prop({ type: Date, default: null, index: true })
  timestamp: Date | null;

  // Normalized trade direction
  @Prop({ type: String, default: null, index: true })
  tokenIn: string | null;

  @Prop({ type: String, default: null, index: true })
  tokenOut: string | null;

  @Prop({ type: String, default: null })
  amountInRaw: string | null;

  @Prop({ type: String, default: null })
  amountOutRaw: string | null;

  // Optional computed notional at the block.
  @Prop({ type: String, default: null, index: true })
  amountUsd: string | null;

  // Participants (optional; depends on decoder)
  @Prop({ type: String, default: null, index: true })
  sender: string | null;

  @Prop({ type: String, default: null, index: true })
  recipient: string | null;

  // V3 extras (nullable)
  @Prop({ type: String, default: null })
  sqrtPriceX96: string | null;

  @Prop({ type: Number, default: null })
  tick: number | null;

  @Prop({ type: String, default: null })
  liquidity: string | null;

  @Prop({ type: Number, default: null })
  fee: number | null;
}

export const SwapSchema = SchemaFactory.createForClass(Swap);

// Idempotency: one derived swap per on-chain log.
SwapSchema.index(
  { chainId: 1, txHash: 1, logIndex: 1 },
  { unique: true, name: 'uniq_chain_tx_log' },
);

// Query helpers for common analytics.
SwapSchema.index(
  { chainId: 1, poolAddress: 1, blockNumber: 1 },
  { name: 'by_pool_block' },
);
SwapSchema.index(
  { chainId: 1, poolAddress: 1, timestamp: 1 },
  { name: 'by_pool_time' },
);
SwapSchema.index({ amountUsd: 1 }, { name: 'by_amount_usd' });
SwapSchema.index({ tokenIn: 1 }, { name: 'by_token_in' });
SwapSchema.index({ tokenOut: 1 }, { name: 'by_token_out' });
