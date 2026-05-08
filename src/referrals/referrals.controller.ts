import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { AuthWalletService } from '../auth-wallet/auth-wallet.service';
import { normalizeAddress } from '../common/evm';

@Controller('referrals')
export class ReferralsController {
  constructor(
    private readonly referralsService: ReferralsService,
    private readonly authWallet: AuthWalletService,
  ) {}

  @Get('validate')
  async validateReferralCode(
    @Query('referralCode') referralCode: string,
    @Query('referredAddress') referredAddress?: string,
  ) {
    return this.referralsService.validateReferralCode({
      referralCode: referralCode ?? '',
      referredAddress,
    });
  }

  @Get('code')
  async getReferralCode(@Query('inviterAddress') inviterAddress: string) {
    return this.referralsService.getReferralCodeForInviter(inviterAddress);
  }

  @Post('code')
  async createReferralCode(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      inviterAddress: string;
      referralCode: string;
    },
  ) {
    const session = this.authWallet.validateSession(authorization);
    const inviterFromToken = normalizeAddress(session.address);
    if (typeof body?.inviterAddress !== 'string') {
      throw new BadRequestException('Invalid inviterAddress');
    }
    const inviterFromBody = normalizeAddress(body.inviterAddress);
    if (inviterFromBody !== inviterFromToken) {
      // Do not allow creating a code for a different wallet than the token owner.
      // The client must send a token for the inviter wallet they claim.
      throw new UnauthorizedException('Inviter wallet does not match token');
    }
    if (typeof body.referralCode !== 'string') {
      throw new BadRequestException('Invalid referralCode');
    }
    return this.referralsService.createReferralCode({
      inviterAddress: inviterFromToken,
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
