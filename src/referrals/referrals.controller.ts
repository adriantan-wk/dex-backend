import { Body, Controller, Post } from '@nestjs/common';
import { ReferralsService } from './referrals.service';

@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Post('code')
  async createReferralCode(
    @Body()
    body: {
      inviterAddress: string;
    },
  ) {
    return this.referralsService.createReferralCode({
      inviterAddress: body.inviterAddress,
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
}

