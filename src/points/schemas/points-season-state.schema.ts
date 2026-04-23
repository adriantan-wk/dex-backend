import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PointsSeasonStateDocument = HydratedDocument<PointsSeasonState>;

/** Singleton document (`_id: 'singleton'`): `points_accounts` totals reflect `activeSeasonId`. */
@Schema({ collection: 'points_season_state', timestamps: false })
export class PointsSeasonState {
  @Prop({ type: String, required: true })
  activeSeasonId!: string;
}

export const PointsSeasonStateSchema =
  SchemaFactory.createForClass(PointsSeasonState);
