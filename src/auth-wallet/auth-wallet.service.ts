import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { SignOptions } from 'jsonwebtoken';
import * as jwt from 'jsonwebtoken';
import { getAddress, isAddress, verifyMessage } from 'viem';

interface StoredChallenge {
  message: string;
  address: string;
  chainId: number;
  expiresAt: number;
}

@Injectable()
export class AuthWalletService {
  private readonly challenges = new Map<string, StoredChallenge>();

  private readonly jwtSecret: string;

  private readonly jwtExpires: string;

  constructor(private readonly config: ConfigService) {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET is required for wallet auth (set in dex-backend .env)',
      );
    }
    this.jwtSecret = secret ?? 'dev-insecure-wallet-jwt-secret';
    this.jwtExpires = this.config.get<string>('JWT_EXPIRES_IN') ?? '7d';
  }

  createChallenge(addressRaw: string, chainId: number) {
    if (!Number.isFinite(chainId)) {
      throw new BadRequestException('Invalid chainId');
    }
    if (!isAddress(addressRaw)) {
      throw new BadRequestException('Invalid address');
    }
    const address = getAddress(addressRaw);
    const challengeId = randomUUID();
    const issuedAt = new Date().toISOString();
    const message = [
      'Sign in to Helios.Trade',
      '',
      `Wallet: ${address}`,
      `Chain ID: ${chainId}`,
      `Challenge ID: ${challengeId}`,
      `Issued at: ${issuedAt}`,
      '',
      'Signing proves you control this wallet.',
    ].join('\n');

    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.challenges.set(challengeId, {
      message,
      address,
      chainId,
      expiresAt,
    });
    this.gcChallenges();

    return { challengeId, message };
  }

  private gcChallenges() {
    const now = Date.now();
    for (const [id, ch] of this.challenges) {
      if (ch.expiresAt < now) this.challenges.delete(id);
    }
  }

  async verifyAndIssueJwt(input: {
    challengeId: string;
    signature: `0x${string}`;
    address: string;
    chainId: number;
  }) {
    const ch = this.challenges.get(input.challengeId);
    if (!ch || ch.expiresAt < Date.now()) {
      if (ch) this.challenges.delete(input.challengeId);
      throw new UnauthorizedException('Challenge not found or expired');
    }

    if (!isAddress(input.address)) {
      throw new BadRequestException('Invalid address');
    }
    const addr = getAddress(input.address);
    if (addr !== ch.address) {
      throw new UnauthorizedException('Address mismatch');
    }
    if (input.chainId !== ch.chainId) {
      throw new UnauthorizedException('Chain mismatch');
    }

    const ok = await verifyMessage({
      address: addr,
      message: ch.message,
      signature: input.signature,
    });
    if (!ok) {
      throw new UnauthorizedException('Invalid signature');
    }

    this.challenges.delete(input.challengeId);

    const accessToken = jwt.sign(
      { sub: addr, chainId: ch.chainId, typ: 'wallet' },
      this.jwtSecret,
      { expiresIn: this.jwtExpires as SignOptions['expiresIn'] },
    );

    return { accessToken };
  }

  validateSession(authHeader: string | undefined) {
    const prefix = 'Bearer ';
    if (!authHeader?.startsWith(prefix)) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = authHeader.slice(prefix.length).trim();
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const decoded = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload;
      if (decoded.typ !== 'wallet' || typeof decoded.sub !== 'string') {
        throw new UnauthorizedException('Invalid token');
      }
      const address = getAddress(decoded.sub as `0x${string}`);
      const chainId = Number(decoded.chainId);
      if (!Number.isFinite(chainId)) {
        throw new UnauthorizedException('Invalid token');
      }
      return { address, chainId };
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
