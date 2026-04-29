import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PointsAccountDocument = HydratedDocument<PointsAccount>;

@Schema({ collection: 'points_accounts', timestamps: true })
export class PointsAccount {
  @Prop({ type: String, required: true, index: true })
  address!: string;

  /** Incrementing season number (1, 2, 3, ...) */
  @Prop({ type: Number, required: true, index: true })
  seasonId!: number;

  // Single points total for swaps (can diverge from USD volume over time).
  @Prop({
    type: Types.Decimal128,
    required: true,
    default: () => Types.Decimal128.fromString('0'),
  })
  swapPoints!: Types.Decimal128;

  // Stored for convenience / analytics; not the source of truth for points.
  @Prop({
    type: Types.Decimal128,
    required: true,
    default: () => Types.Decimal128.fromString('0'),
  })
  swapUsdVolume!: Types.Decimal128;

  // Current swap streak day (1-indexed). Resets to 1 after a missed day.
  @Prop({ type: Number, required: true, default: 0 })
  swapStreakDay!: number;

  // Current multiplier for the current day (cached for display).
  @Prop({
    type: Types.Decimal128,
    required: true,
    default: () => Types.Decimal128.fromString('1'),
  })
  swapMultiplier!: Types.Decimal128;

  // Last UTC day index we recorded at least one swap for this user.
  @Prop({ type: Number, required: false })
  lastSwapDayIndex?: number;
}

export const PointsAccountSchema = SchemaFactory.createForClass(PointsAccount);

PointsAccountSchema.index(
  { address: 1, seasonId: 1 },
  { unique: true, name: 'uniq_address_season' },
);
PointsAccountSchema.index(
  { seasonId: 1, swapPoints: -1, swapUsdVolume: -1, address: 1 },
  { name: 'by_season_points_rank' },
);
