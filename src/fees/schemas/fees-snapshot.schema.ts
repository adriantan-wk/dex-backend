import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FeesSnapshotDocument = HydratedDocument<FeesSnapshot>;

@Schema({
  collection: 'fees_snapshots',
  timestamps: { createdAt: true, updatedAt: false },
})
export class FeesSnapshot {
  /**
   * Snapshot key for a time bucket (ISO UTC bucket start).
   * Example: "2026-05-05T09:00:00Z"
   */
  @Prop({ type: String, required: true })
  _id!: string;

  /** Bucket start timestamp (unix seconds, UTC). */
  @Prop({ type: Number, required: true, index: true })
  bucketStartSec!: number;

  /** Bucket end timestamp (unix seconds, UTC, exclusive). */
  @Prop({ type: Number, required: true, index: true })
  bucketEndSec!: number;

  /** Bucket size in seconds (e.g. 3600, 86400, 604800). */
  @Prop({ type: Number, required: true, index: true })
  intervalSec!: number;

  /** Total fees added during this run (USD). */
  @Prop({ type: Types.Decimal128, required: true })
  feesAddedUsd!: Types.Decimal128;

  /** Breakdown by protocol (USD). */
  @Prop({ type: Types.Decimal128, required: true })
  feesAddedUsdV2!: Types.Decimal128;

  @Prop({ type: Types.Decimal128, required: true })
  feesAddedUsdV3!: Types.Decimal128;

  /** Swap counts processed during this run. */
  @Prop({ type: Number, required: true })
  swapsProcessedV2!: number;

  @Prop({ type: Number, required: true })
  swapsProcessedV3!: number;

  /** Master total after applying this run. */
  @Prop({ type: Types.Decimal128, required: true })
  masterTotalUsdAfter!: Types.Decimal128;

  /** Cursor ranges for observability/debugging. */
  @Prop({ type: Object, required: true })
  cursors!: {
    v2: { fromTs: number; fromId: string; toTs: number; toId: string };
    v3: { fromTs: number; fromId: string; toTs: number; toId: string };
  };
}

export const FeesSnapshotSchema = SchemaFactory.createForClass(FeesSnapshot);
