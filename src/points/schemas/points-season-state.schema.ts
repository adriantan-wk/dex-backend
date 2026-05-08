import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PointsSeasonStateDocument = HydratedDocument<PointsSeasonState>;

/** Singleton document (`_id: 'singleton'`): `points_accounts` totals reflect `activeSeasonId`. */
@Schema({ collection: 'points_season_state', timestamps: false })
export class PointsSeasonState {
  /** Incrementing season number (1, 2, 3, ...) */
  @Prop({ type: Number, required: true })
  activeSeasonId!: number;

  /**
   * Rollover cursor.
   *
   * Historical: `YYYY-MM` (one season per UTC calendar month).
   * If `POINTS_SEASON_INTERVAL` is set: ISO UTC bucket start like `2026-05-05T00:00:00Z`.
   */
  @Prop({ type: String, required: true })
  activeSeasonMonthKey!: string;

  /**
   * If `POINTS_SEASON_INTERVAL` is set, this stores the current season bucket start.
   * Optional for backward compatibility (older documents won't have it).
   */
  @Prop({ type: Number, required: false })
  activeSeasonStartSec?: number;

  /** If `POINTS_SEASON_INTERVAL` is set, stores the interval in seconds. */
  @Prop({ type: Number, required: false })
  activeSeasonIntervalSec?: number;
}

export const PointsSeasonStateSchema =
  SchemaFactory.createForClass(PointsSeasonState);
