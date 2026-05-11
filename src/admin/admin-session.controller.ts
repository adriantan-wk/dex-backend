import { Controller, Get, Headers, UseGuards } from '@nestjs/common';
import { AuthWalletService } from '../auth-wallet/auth-wallet.service';
import { AdminGuard } from './admin.guard';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminSessionController {
  constructor(private readonly authWallet: AuthWalletService) {}

  @Get('session')
  session(@Headers('authorization') authorization: string | undefined) {
    return this.authWallet.validateSession(authorization);
  }
}
