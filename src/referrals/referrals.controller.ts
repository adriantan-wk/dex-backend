import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ReferralsService } from './referrals.service';

@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('code')
  async getReferralCode(@Query('inviterAddress') inviterAddress: string) {
    return this.referralsService.getReferralCodeForInviter(inviterAddress);
  }

  @Post('code')
  async createReferralCode(
    @Body()
    body: {
      inviterAddress: string;
      referralCode: string;
    },
  ) {
    return this.referralsService.createReferralCode({
      inviterAddress: body.inviterAddress,
      referralCode: body.referralCode,
    });
  }

  @Post('claim')
  async claimReferral(
    @Body()
    body: {
      referralCode: string;
      referredAddress: string;
    },
  ) {
    return this.referralsService.claimReferral({
      referralCode: body.referralCode,
      referredAddress: body.referredAddress,
    });
  }

  @Get('my-claim')
  async getMyReferralClaim(@Query('referredAddress') referredAddress: string) {
    return this.referralsService.getReferralClaimForReferred(referredAddress);
  }

  @Get('counts')
  async getReferralCounts(@Query('inviterAddress') inviterAddress: string) {
    return this.referralsService.getReferralCounts(inviterAddress);
  }
}
