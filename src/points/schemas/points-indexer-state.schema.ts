import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PointsIndexerStateDocument = HydratedDocument<PointsIndexerState>;

/** Cursor for subgraph -> points awards (one row per source). */
@Schema({ collection: 'points_indexer_state', timestamps: true })
export class PointsIndexerState {
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

export const PointsIndexerStateSchema =
  SchemaFactory.createForClass(PointsIndexerState);
