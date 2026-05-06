import { Module } from '@nestjs/common';
import { AuthWalletController } from './auth-wallet.controller';
import { AuthWalletService } from './auth-wallet.service';

@Module({
  controllers: [AuthWalletController],
  providers: [AuthWalletService],
  exports: [AuthWalletService],
})
export class AuthWalletModule {}
