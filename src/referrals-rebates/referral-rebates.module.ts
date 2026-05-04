import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferralRebatesCron } from './referral-rebates.cron';
import { ReferralRebatesService } from './referral-rebates.service';
import {
  ReferralIndexerState,
  ReferralIndexerStateSchema,
} from './schemas/referral-indexer-state.schema';
import {
  ReferralFeeAccrual,
  ReferralFeeAccrualSchema,
} from './schemas/referral-fee-accrual.schema';
import {
  ReferralUserState,
  ReferralUserStateSchema,
} from './schemas/referral-user-state.schema';
import {
  ReferralClaim,
  ReferralClaimSchema,
} from '../referrals/schemas/referral-claim.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReferralIndexerState.name, schema: ReferralIndexerStateSchema },
      { name: ReferralFeeAccrual.name, schema: ReferralFeeAccrualSchema },
      { name: ReferralUserState.name, schema: ReferralUserStateSchema },
      { name: ReferralClaim.name, schema: ReferralClaimSchema },
    ]),
  ],
  providers: [ReferralRebatesCron, ReferralRebatesService],
  exports: [ReferralRebatesService, ReferralRebatesCron],
})
export class ReferralRebatesModule {}
