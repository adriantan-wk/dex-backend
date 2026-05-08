import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReferralCodeDocument = HydratedDocument<ReferralCode>;

@Schema({ collection: 'referral_codes', timestamps: true })
export class ReferralCode {
  // Address that owns the code (inviter).
  @Prop({ type: String, required: true, index: true })
  inviterAddress!: string;

  // Opaque code shown in referral link (invitee must not learn inviter address).
  @Prop({ type: String, required: true, unique: true, index: true })
  referralCode!: string;
}

export const ReferralCodeSchema = SchemaFactory.createForClass(ReferralCode);

ReferralCodeSchema.index(
  { inviterAddress: 1, referralCode: 1 },
  { unique: true },
);
