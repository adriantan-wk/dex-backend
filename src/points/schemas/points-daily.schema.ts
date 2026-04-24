import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PointsDailyDocument = HydratedDocument<PointsDaily>;

@Schema({
  collection: 'points_daily',
  timestamps: { createdAt: true, updatedAt: false },
})
export class PointsDaily {
  @Prop({ type: String, required: true, index: true })
  address!: string;

  /** Incrementing season number (1, 2, 3, ...) */
  @Prop({ type: Number, required: true, index: true })
  seasonId!: number;

  // Streak bucket index: see `points-time.config.ts` (`utcDayIndexFromUnixSeconds`).
  @Prop({ type: Number, required: true })
  dayIndex!: number;

  @Prop({ type: Number, required: true })
  streakDay!: number;

  @Prop({ type: Types.Decimal128, required: true })
  multiplier!: Types.Decimal128;
}

export const PointsDailySchema = SchemaFactory.createForClass(PointsDaily);

PointsDailySchema.index(
  { address: 1, seasonId: 1, dayIndex: 1 },
  { unique: true, name: 'uniq_address_season_day' },
);
