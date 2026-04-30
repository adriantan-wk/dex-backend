import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FeesDailySnapshotDocument = HydratedDocument<FeesDailySnapshot>;

@Schema({
  collection: 'fees_daily_snapshots',
  timestamps: { createdAt: true, updatedAt: false },
})
export class FeesDailySnapshot {
  /** UTC date key like "2026-04-30". */
  @Prop({ type: String, required: true })
  _id!: string;

  /** UTC day index (unix seconds / 86400). */
  @Prop({ type: Number, required: true, index: true })
  dayIndex!: number;

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

export const FeesDailySnapshotSchema =
  SchemaFactory.createForClass(FeesDailySnapshot);

