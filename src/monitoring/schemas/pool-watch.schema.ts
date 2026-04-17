import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type PoolWatchDocument = HydratedDocument<PoolWatch>;

@Schema({
  collection: 'pool_watchlist',
  timestamps: { createdAt: true, updatedAt: false },
})
export class PoolWatch {
  @Prop({ required: true, index: true })
  chainId: number;

  @Prop({ required: true, index: true })
  poolAddress: string;
}

export const PoolWatchSchema = SchemaFactory.createForClass(PoolWatch);

PoolWatchSchema.index(
  { chainId: 1, poolAddress: 1 },
  { unique: true, name: 'uniq_chain_pool' },
);
