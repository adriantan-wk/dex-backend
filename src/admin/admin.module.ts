import { Module } from '@nestjs/common';
import { ReferralRebatesModule } from '../referrals-rebates/referral-rebates.module';
import { AdminReferralsController } from './admin.controller';

/**
 * Admin module. Initially exposes the referral-rebate review endpoints with
 * no authentication so the team can sanity-check the numbers.
 *
 * The signed-nonce + JWT gate planned in
 * `referral_fee-sharing_system.plan.md` will be added on top of this module
 * later as a dedicated `admin-auth` submodule + `AdminGuard`.
 */
@Module({
  imports: [ReferralRebatesModule],
  controllers: [AdminReferralsController],
})
export class AdminModule {}
