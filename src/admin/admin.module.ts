import { Module } from '@nestjs/common';
import { AuthWalletModule } from '../auth-wallet/auth-wallet.module';
import { ReferralRebatesModule } from '../referrals-rebates/referral-rebates.module';
import { AdminReferralsController } from './admin.controller';
import { AdminSessionController } from './admin-session.controller';
import { AdminGuard } from './admin.guard';

/**
 * Admin module. Initially exposes the referral-rebate review endpoints with
 * no authentication so the team can sanity-check the numbers.
 *
 * The signed-nonce + JWT gate planned in
 * `referral_fee-sharing_system.plan.md` will be added on top of this module
 * later as a dedicated `admin-auth` submodule + `AdminGuard`.
 */
@Module({
  imports: [ReferralRebatesModule, AuthWalletModule],
  controllers: [AdminReferralsController, AdminSessionController],
  providers: [AdminGuard],
})
export class AdminModule {}
