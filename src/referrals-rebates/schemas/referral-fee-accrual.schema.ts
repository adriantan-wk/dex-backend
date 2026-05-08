import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReferralFeeAccrualDocument = HydratedDocument<ReferralFeeAccrual>;

/**
 * Append-only ledger: one row per (swap × recipient × level).
 *
 * Token amounts are stored as decimal strings in their natural (raw) units so
 * we don't lose precision. USD figures use Decimal128 for stats/admin.
 */
@Schema({ collection: 'referral_fee_accruals', timestamps: true })
export class ReferralFeeAccrual {
  /** Inviter earning the rebate. Lower-cased EVM address. */
  @Prop({ type: String, required: true, index: true })
  recipientAddress!: string;

  /** Referee whose swap fee is being shared. Lower-cased EVM address. */
  @Prop({ type: String, required: true, index: true })
  payerAddress!: string;

  /** 1 = direct referral, 2 = indirect (referee of a referee). */
  @Prop({ type: Number, required: true })
  level!: 1 | 2;

  /** Lower-cased ERC20 contract address of the input token. */
  @Prop({ type: String, required: true, index: true })
  tokenAddress!: string;

  @Prop({ type: String, required: true })
  tokenSymbol!: string;

  @Prop({ type: Number, required: true })
  tokenDecimals!: number;

  /**
   * Recipient's share of this swap's fee, in raw token units (i.e. multiplied
   * by `10^tokenDecimals`). Stored as a decimal string to preserve precision.
   */
  @Prop({ type: String, required: true })
  feeAmountRaw!: string;

  /** USD value of `feeAmountRaw` at the time the swap was indexed. */
  @Prop({ type: Types.Decimal128, required: true })
  feeAmountUsd!: Types.Decimal128;

  /** Tier % applied (e.g. `10`, `12.5`, …) – snapshot at accrual time. */
  @Prop({ type: String, required: true })
  tierPctApplied!: string;

  /** Recipient's epoch id at the time of accrual (`<tierIndex>:<startedAt>`). */
  @Prop({ type: String, required: true, index: true })
  recipientEpochId!: string;

  /** Subgraph swap id (e.g. `txHash#index`). */
  @Prop({ type: String, required: true })
  swapId!: string;

  /** Unix seconds, UTC. */
  @Prop({ type: Number, required: true, index: true })
  swapTimestamp!: number;

  /** `v2` or `v3`. */
  @Prop({ type: String, required: true })
  source!: 'v2' | 'v3';
}

export const ReferralFeeAccrualSchema =
  SchemaFactory.createForClass(ReferralFeeAccrual);

// Idempotency: re-running the cron for the same swap upserts the same row
// instead of creating duplicates.
ReferralFeeAccrualSchema.index(
  { source: 1, swapId: 1, recipientAddress: 1, level: 1 },
  { unique: true, name: 'unique_swap_recipient_level' },
);

ReferralFeeAccrualSchema.index(
  { recipientAddress: 1, recipientEpochId: 1 },
  { name: 'by_recipient_epoch' },
);

ReferralFeeAccrualSchema.index(
  { recipientAddress: 1, payerAddress: 1, level: 1, tokenAddress: 1 },
  { name: 'by_recipient_payer_level_token' },
);
