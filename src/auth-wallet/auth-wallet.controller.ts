import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
} from '@nestjs/common';
import { AuthWalletService } from './auth-wallet.service';

@Controller('auth/wallet')
export class AuthWalletController {
  constructor(private readonly authWallet: AuthWalletService) {}

  @Post('challenge')
  challenge(@Body() body: { address?: string; chainId?: number }) {
    if (typeof body?.address !== 'string' || body.chainId === undefined) {
      throw new BadRequestException('address and chainId are required');
    }
    const chainId = Number(body.chainId);
    return this.authWallet.createChallenge(body.address, chainId);
  }

  @Post('verify')
  verify(
    @Body()
    body: {
      challengeId?: string;
      signature?: string;
      address?: string;
      chainId?: number;
    },
  ) {
    if (
      typeof body?.challengeId !== 'string' ||
      typeof body?.signature !== 'string' ||
      typeof body?.address !== 'string' ||
      body.chainId === undefined
    ) {
      throw new BadRequestException(
        'challengeId, signature, address, and chainId are required',
      );
    }
    const chainId = Number(body.chainId);
    return this.authWallet.verifyAndIssueJwt({
      challengeId: body.challengeId,
      signature: body.signature as `0x${string}`,
      address: body.address,
      chainId,
    });
  }

  @Get('session')
  session(@Headers('authorization') authorization: string | undefined) {
    return this.authWallet.validateSession(authorization);
  }
}
