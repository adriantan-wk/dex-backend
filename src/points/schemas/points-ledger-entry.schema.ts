import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PointsLedgerEntryDocument = HydratedDocument<PointsLedgerEntry>;

export type PointsSourceType = 'swap';

@Schema({
  collection: 'points_ledger',
  timestamps: { createdAt: true, updatedAt: false },
})
export class PointsLedgerEntry {
  @Prop({ type: String, required: true, index: true })
  address!: string;

  @Prop({ type: String, required: true })
  sourceType!: PointsSourceType;

  // For swaps, this should be tx hash.
  @Prop({ type: String, required: true })
  sourceId!: string;

  @Prop({ type: Number, required: true })
  chainId!: number;

  @Prop({ type: Types.Decimal128, required: true })
  usdAmount!: Types.Decimal128;

  @Prop({ type: Types.Decimal128, required: true })
  points!: Types.Decimal128;

  // Daily streak multiplier applied to this award.
  @Prop({
    type: Types.Decimal128,
    required: true,
    default: () => Types.Decimal128.fromString('1'),
  })
  multiplier!: Types.Decimal128;

  // The user's streak day used for this award (1-indexed).
  @Prop({ type: Number, required: true, default: 1 })
  streakDay!: number;

  // UTC day index at award-time: floor(unixSeconds / 86400)
  @Prop({ type: Number, required: true })
  dayIndex!: number;

  // Reserved for future formula changes (streaks, multipliers, seasonal boosts, etc).
  @Prop({ type: Number, required: true, default: 1 })
  pointsFormulaVersion!: number;

  @Prop({ type: Object, required: false })
  metadata?: Record<string, unknown>;
}

export const PointsLedgerEntrySchema =
  SchemaFactory.createForClass(PointsLedgerEntry);

PointsLedgerEntrySchema.index(
  { sourceType: 1, sourceId: 1, chainId: 1 },
  { unique: true, name: 'uniq_source' },
);
PointsLedgerEntrySchema.index(
  { address: 1, createdAt: -1 },
  { name: 'by_address_recent' },
);
