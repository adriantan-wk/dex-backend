import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PointsSeasonStateDocument = HydratedDocument<PointsSeasonState>;

/** Singleton document (`_id: 'singleton'`): `points_accounts` totals reflect `activeSeasonId`. */
@Schema({ collection: 'points_season_state', timestamps: false })
export class PointsSeasonState {
  /** Incrementing season number (1, 2, 3, ...) */
  @Prop({ type: Number, required: true })
  activeSeasonId!: number;

  /** Rollover cursor (`YYYY-MM`); see `points-time.config.ts`. */
  @Prop({ type: String, required: true })
  activeSeasonMonthKey!: string;
}

export const PointsSeasonStateSchema =
  SchemaFactory.createForClass(PointsSeasonState);
