import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReferralIndexerStateDocument =
  HydratedDocument<ReferralIndexerState>;

/**
 * Cursor for the rebate cron, kept separate from `fees_indexer_state` so we can
 * replay/backfill rebates without disturbing the global fees counters.
 */
@Schema({ collection: 'referral_indexer_state', timestamps: true })
export class ReferralIndexerState {
  /** `'v2'` or `'v3'`. */
  @Prop({ type: String, required: true })
  _id!: string;

  /** Last processed swap timestamp (unix seconds, UTC). */
  @Prop({ type: Number, required: true, default: 0 })
  lastProcessedTimestampSec!: number;

  /** Subgraph swap id of the last processed swap (tie-breaker for same ts). */
  @Prop({ type: String, required: true, default: '' })
  lastProcessedSwapId!: string;
}

export const ReferralIndexerStateSchema =
  SchemaFactory.createForClass(ReferralIndexerState);
