import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ReferralRebatesCron } from '../referrals-rebates/referral-rebates.cron';
import { ReferralRebatesService } from '../referrals-rebates/referral-rebates.service';
import { AdminGuard } from './admin.guard';

/**
 * Admin endpoints surfacing the referral rebate ledger.
 *
 * NOTE: gating (signed-nonce login + JWT) is deferred. These endpoints are
 * currently public so we can review the rebate numbers in the admin UI before
 * any auth machinery is built.
 */
@Controller('admin/referrals')
@UseGuards(AdminGuard)
export class AdminReferralsController {
  constructor(
    private readonly rebatesService: ReferralRebatesService,
    private readonly rebatesCron: ReferralRebatesCron,
  ) {}

  @Get('users')
  async listUsers(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
  ) {
    const pageNum = page ? Number(page) : 1;
    const sizeNum = pageSize ? Number(pageSize) : 25;
    const sortKey =
      sort === 'claimableUsd' || sort === 'directReferrals'
        ? sort
        : 'lifetimeUsd';
    return this.rebatesService.getAdminUsers({
      page: Number.isFinite(pageNum) ? pageNum : 1,
      pageSize: Number.isFinite(sizeNum) ? sizeNum : 25,
      sort: sortKey,
    });
  }

  @Get('users/:address')
  async getUser(@Param('address') address: string) {
    return this.rebatesService.getAdminUserBreakdown(address);
  }

  /**
   * Manually trigger the rebate cron. Useful while reviewing the system in the
   * admin panel without waiting for the next hourly tick.
   */
  @Post('sync')
  async manualSync() {
    return this.rebatesCron.runSync('manual');
  }
}
