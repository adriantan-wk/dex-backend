import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { DexProtocol } from './swap.schema';

export type MintDocument = HydratedDocument<Mint>;

@Schema({
  collection: 'mints',
  timestamps: { createdAt: true, updatedAt: true },
})
export class Mint {
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

  @Prop({ type: Date, default: null, index: true })
  timestamp: Date | null;

  @Prop({ type: String, default: null, index: true })
  token0: string | null;

  @Prop({ type: String, default: null, index: true })
  token1: string | null;

  @Prop({ type: String, default: null })
  amount0: string | null;

  @Prop({ type: String, default: null })
  amount1: string | null;

  /** V3: liquidity delta from Mint event (`amount` in the pool contract). */
  @Prop({ type: String, default: null })
  liquidity: string | null;

  @Prop({ type: Number, default: null })
  tickLower: number | null;

  @Prop({ type: Number, default: null })
  tickUpper: number | null;

  @Prop({ type: String, default: null, index: true })
  sender: string | null;

  @Prop({ type: String, default: null, index: true })
  owner: string | null;

  @Prop({ type: String, default: null, index: true })
  amountUsd: string | null;

  @Prop({ type: Number, default: null })
  fee: number | null;
}

export const MintSchema = SchemaFactory.createForClass(Mint);

MintSchema.index(
  { chainId: 1, txHash: 1, logIndex: 1 },
  { unique: true, name: 'uniq_chain_tx_log_mint' },
);

MintSchema.index(
  { chainId: 1, poolAddress: 1, blockNumber: 1 },
  { name: 'mint_by_pool_block' },
);
