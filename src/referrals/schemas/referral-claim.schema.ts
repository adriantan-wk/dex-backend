import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReferralClaimDocument = HydratedDocument<ReferralClaim>;

@Schema({ collection: 'referral_claims', timestamps: true })
export class ReferralClaim {
  // Address that created / owns the referral link.
  @Prop({ type: String, required: true, index: true })
  inviterAddress!: string;

  // Address that claimed the referral link (registered).
  @Prop({ type: String, required: true, unique: true })
  referredAddress!: string;

  // Stored so we can later attribute fees by code if desired.
  // This is an opaque token shown in referral links.
  @Prop({ type: String, required: true })
  referralCode!: string;

  // reserved for future analytics/eligibility rules
  @Prop({ type: Number, required: false })
  claimedSeasonId?: number;

  // Useful for future fee distribution metadata
  @Prop({ type: Object, required: false })
  metadata?: Record<string, unknown>;
}

export const ReferralClaimSchema = SchemaFactory.createForClass(ReferralClaim);

ReferralClaimSchema.index(
  { inviterAddress: 1, createdAt: -1 },
  { name: 'by_inviter' },
);
