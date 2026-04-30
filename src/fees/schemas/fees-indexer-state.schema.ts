import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FeesIndexerStateDocument = HydratedDocument<FeesIndexerState>;

/** Cursor for subgraph -> site fee aggregation (one row per source). */
@Schema({ collection: 'fees_indexer_state', timestamps: true })
export class FeesIndexerState {
  @Prop({ type: String, required: true })
  _id!: string;

  /** Last processed swap timestamp (unix seconds, UTC). */
  @Prop({ type: Number, required: true, default: 0 })
  lastProcessedTimestampSec!: number;

  /**
   * Tie-breaker cursor for swaps with the same timestamp.
   * Should be the subgraph `Swap.id` (stable ordering).
   */
  @Prop({ type: String, required: true, default: '' })
  lastProcessedSwapId!: string;
}

export const FeesIndexerStateSchema =
  SchemaFactory.createForClass(FeesIndexerState);

