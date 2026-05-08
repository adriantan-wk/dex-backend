import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FeesMasterTotalDocument = HydratedDocument<FeesMasterTotal>;

@Schema({ collection: 'fees_master_total', timestamps: true })
export class FeesMasterTotal {
  @Prop({ type: String, required: true })
  _id!: string;

  /** Running total of fees across the site (USD). */
  @Prop({ type: Types.Decimal128, required: true })
  totalFeesUsd!: Types.Decimal128;
}

export const FeesMasterTotalSchema =
  SchemaFactory.createForClass(FeesMasterTotal);
