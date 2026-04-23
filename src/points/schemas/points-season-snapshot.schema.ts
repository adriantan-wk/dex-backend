import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PointsSeasonSnapshotDocument = HydratedDocument<PointsSeasonSnapshot>;

export type PointsSeasonLeaderboardRow = {
  rank: number;
  address: string;
  swapPoints: string;
  swapUsdVolume: string;
};

@Schema({ collection: 'points_season_snapshots', timestamps: false })
export class PointsSeasonSnapshot {
  /** UTC calendar month key: YYYY-MM */
  @Prop({ type: String, required: true, unique: true, index: true })
  seasonId!: string;

  @Prop({ type: Date, required: true })
  finalizedAt!: Date;

  @Prop({ type: Array, required: true })
  entries!: PointsSeasonLeaderboardRow[];
}

export const PointsSeasonSnapshotSchema =
  SchemaFactory.createForClass(PointsSeasonSnapshot);
