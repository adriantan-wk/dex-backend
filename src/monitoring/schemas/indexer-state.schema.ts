import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type IndexerStateDocument = HydratedDocument<IndexerState>;

@Schema({
  collection: 'indexer_state',
  timestamps: { createdAt: true, updatedAt: true },
})
export class IndexerState {
  @Prop({ required: true, index: true, unique: true })
  chainId: number;

  // "Safe" scanned block (tip minus reorg safety blocks).
  @Prop({ type: Number, default: null })
  lastFinalizedBlock!: number | null;

  // Latest observed chain tip.
  @Prop({ type: Number, default: null })
  lastSeenTip: number | null;

  @Prop({ required: true })
  lastSeenAt: Date;
}

export const IndexerStateSchema = SchemaFactory.createForClass(IndexerState);
