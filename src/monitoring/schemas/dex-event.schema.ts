import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type DexEventDocument = HydratedDocument<DexEvent>;

@Schema({
  collection: 'dex_events',
  timestamps: { createdAt: true, updatedAt: true },
})
export class DexEvent {
  @Prop({ required: true, index: true })
  chainId: number;

  @Prop({ required: true, index: true })
  blockNumber: number;

  @Prop({ required: true, index: true })
  logIndex: number;

  @Prop({ required: true })
  txHash: string;

  @Prop({ required: true, index: true })
  address: string; // pool/pair/factory emitting the log

  @Prop({ required: true, index: true })
  eventType: string; // e.g. Swap, Mint, Burn, PairCreated, PoolCreated

  @Prop({ type: Object, required: true })
  data: Record<string, unknown>; // decoded fields
}

export const DexEventSchema = SchemaFactory.createForClass(DexEvent);

// Prevent duplicates even if we overlap block ranges / retry.
DexEventSchema.index(
  { chainId: 1, blockNumber: 1, logIndex: 1 },
  { unique: true, name: 'uniq_chain_block_log' },
);
