import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReferralUserStateDocument = HydratedDocument<ReferralUserState>;

/**
 * Per-recipient state. The cron rolls epochs lazily here rather than running a
 * separate scheduler – any time we touch the user (because a referee swapped),
 * we re-evaluate their tier and roll the epoch forward if it has expired.
 *
 * `_id` is the lower-cased EVM address.
 */
@Schema({ collection: 'referral_user_state', timestamps: true })
export class ReferralUserState {
  @Prop({ type: String, required: true })
  _id!: string;

  /** Denormalised count of referral_claims where this address is the inviter. */
  @Prop({ type: Number, required: true, default: 0 })
  directReferralsCount!: number;

  /** Index into the tier table at the last accrual. */
  @Prop({ type: Number, required: true, default: 0 })
  currentTierIndex!: number;

  /** `<tierIndex>:<startedAtSec>` */
  @Prop({ type: String, required: true, default: '' })
  currentEpochId!: string;

  @Prop({ type: Number, required: true, default: 0 })
  currentEpochStartedAt!: number;

  @Prop({ type: Number, required: true, default: 14 })
  currentEpochLengthDays!: number;

  /** Unix seconds of the most recent on-chain claim. 0 means never. */
  @Prop({ type: Number, required: true, default: 0 })
  lastClaimAt!: number;

  /** Monotonically increasing nonce for EIP-712 replay protection. */
  @Prop({ type: Number, required: true, default: 0 })
  claimNonce!: number;
}

export const ReferralUserStateSchema =
  SchemaFactory.createForClass(ReferralUserState);
