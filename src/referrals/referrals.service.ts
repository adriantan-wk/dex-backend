import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import crypto from 'crypto';
import {
  ReferralClaim,
  ReferralClaimDocument,
} from './schemas/referral-claim.schema';
import {
  ReferralCode,
  ReferralCodeDocument,
} from './schemas/referral-code.schema';
import {
  PointsLedgerEntry,
  PointsLedgerEntryDocument,
} from '../points/schemas/points-ledger-entry.schema';

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function isEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

@Injectable()
export class ReferralsService {
  constructor(
    @InjectModel(ReferralClaim.name)
    private readonly claimModel: Model<ReferralClaimDocument>,
    @InjectModel(ReferralCode.name)
    private readonly codeModel: Model<ReferralCodeDocument>,
    @InjectModel(PointsLedgerEntry.name)
    private readonly ledgerModel: Model<PointsLedgerEntryDocument>,
  ) {}

  async createReferralCode(input: { inviterAddress: string }) {
    const inviterAddress = normalizeAddress(input.inviterAddress);
    if (!isEvmAddress(inviterAddress)) {
      throw new BadRequestException('Invalid inviterAddress');
    }

    // Return existing code if it already exists for this inviter.
    const existingForInviter = await this.codeModel
      .findOne({ inviterAddress })
      .lean();
    if (existingForInviter) {
      return {
        referralCode: existingForInviter.referralCode,
      };
    }

    // Opaque random code shown in the link.
    const referralCode = crypto.randomBytes(16).toString('hex');

    const created = await this.codeModel.create({
      inviterAddress,
      referralCode,
    });

    return {
      referralCode: created.referralCode,
    };
  }

  async claimReferral(input: {
    referralCode: string;
    referredAddress: string;
  }) {
    const referralCode = input.referralCode.trim();
    const referredAddress = normalizeAddress(input.referredAddress);

    if (!referralCode || referralCode.length < 8) {
      throw new BadRequestException('Invalid referral code');
    }
    if (!isEvmAddress(referredAddress)) {
      throw new BadRequestException('Invalid referredAddress');
    }

    const codeRow = await this.codeModel.findOne({ referralCode }).lean();
    if (!codeRow) {
      throw new BadRequestException('Referral code not found');
    }

    if (codeRow.inviterAddress === referredAddress) {
      throw new BadRequestException('You cannot use your own referral link');
    }

    // Eligibility: only wallets with no recorded swaps yet can use codes.
    const hasAnyTx = await this.ledgerModel.exists({ address: referredAddress });
    if (hasAnyTx) {
      throw new BadRequestException('Invite codes are only valid for new wallets');
    }

    const existing = await this.claimModel.findOne({ referredAddress }).lean();
    if (existing) {
      return {
        alreadyClaimed: true as const,
        claimedAt: new Date().toISOString(),
      };
    }

    await this.claimModel.create({
      inviterAddress: codeRow.inviterAddress,
      referredAddress,
      referralCode,
    });

    return {
      alreadyClaimed: false as const,
      claimedAt: new Date().toISOString(),
    };
  }
}

