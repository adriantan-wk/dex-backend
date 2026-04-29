import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PointsLedgerEntryDocument = HydratedDocument<PointsLedgerEntry>;

export type PointsSourceType = 'swap';

/** Which pool subgraph this swap award was indexed from. */
export type PointsPoolProtocol = 'v2' | 'v3';

@Schema({
  collection: 'points_ledger',
  timestamps: { createdAt: true, updatedAt: false },
})
export class PointsLedgerEntry {
  @Prop({ type: String, required: true, index: true })
  address!: string;

  /** Incrementing season number (1, 2, 3, ...) */
  @Prop({ type: Number, required: true, index: true })
  seasonId!: number;

  /** Points account row this award applied to (address+season). */
  @Prop({ type: Types.ObjectId, required: false, index: true })
  pointsAccountId?: Types.ObjectId;

  @Prop({ type: String, required: true })
  sourceType!: PointsSourceType;

  /**
   * Dedupe key: subgraph `Swap.id` (tx hash + delimiter + in-tx index — not raw tx alone).
   */
  @Prop({ type: String, required: true })
  sourceId!: string;

  @Prop({ type: String, required: true })
  poolProtocol!: PointsPoolProtocol;

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

  // Streak bucket index at award-time: see `points-time.config.ts`.
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
PointsLedgerEntrySchema.index(
  { seasonId: 1, address: 1, createdAt: -1 },
  { name: 'by_season_address_recent' },
);
PointsLedgerEntrySchema.index(
  { poolProtocol: 1, chainId: 1 },
  { name: 'by_pool_protocol_chain' },
);
