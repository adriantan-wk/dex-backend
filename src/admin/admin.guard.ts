import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthWalletService } from '../auth-wallet/auth-wallet.service';
import { isAdminWallet } from './admin.allowlist';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly authWallet: AuthWalletService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers?: Record<string, unknown> }>();
    const auth =
      (req?.headers?.authorization as string | undefined) ??
      (req?.headers?.Authorization as string | undefined);

    let session: { address: string; chainId: number };
    try {
      session = this.authWallet.validateSession(auth);
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!isAdminWallet(session.address)) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
