import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

const REFERRAL_CODE_MIN_LEN = 8;
const REFERRAL_CODE_MAX_LEN = 32;

function normalizeReferralCode(raw: string): string {
  return raw.trim().toLowerCase();
}

function assertValidNewReferralCode(code: string): void {
  if (
    code.length < REFERRAL_CODE_MIN_LEN ||
    code.length > REFERRAL_CODE_MAX_LEN
  ) {
    throw new BadRequestException(
      `Referral code must be between ${REFERRAL_CODE_MIN_LEN} and ${REFERRAL_CODE_MAX_LEN} characters`,
    );
  }
  if (!/^[a-z0-9]+$/.test(code)) {
    throw new BadRequestException(
      'Referral code may only contain letters and numbers (no spaces or symbols)',
    );
  }
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

  async getReferralCodeForInviter(inviterAddressRaw: string | undefined) {
    if (!inviterAddressRaw || typeof inviterAddressRaw !== 'string') {
      throw new BadRequestException('Invalid inviterAddress');
    }
    const inviterAddress = normalizeAddress(inviterAddressRaw);
    if (!isEvmAddress(inviterAddress)) {
      throw new BadRequestException('Invalid inviterAddress');
    }

    const existing = await this.codeModel.findOne({ inviterAddress }).lean();
    return {
      referralCode: existing?.referralCode ?? null,
    };
  }

  async createReferralCode(input: {
    inviterAddress: string;
    referralCode: string;
  }) {
    const inviterAddress = normalizeAddress(input.inviterAddress);
    if (!isEvmAddress(inviterAddress)) {
      throw new BadRequestException('Invalid inviterAddress');
    }

    const existingForInviter = await this.codeModel
      .findOne({ inviterAddress })
      .lean();
    if (existingForInviter) {
      throw new BadRequestException(
        'Referral code is already set for this wallet and cannot be changed',
      );
    }

    const referralCode = normalizeReferralCode(input.referralCode);
    assertValidNewReferralCode(referralCode);

    const taken = await this.codeModel.findOne({ referralCode }).lean();
    if (taken) {
      throw new BadRequestException('This referral code is already taken');
    }

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
    const referralCode = normalizeReferralCode(input.referralCode);
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
    const hasAnyTx = await this.ledgerModel.exists({
      address: referredAddress,
    });
    if (hasAnyTx) {
      throw new BadRequestException(
        'Invite codes are only valid for new wallets',
      );
    }

    const existing = await this.claimModel.findOne({ referredAddress }).lean();
    if (existing) {
      const row = existing as typeof existing & { createdAt?: Date | string };
      const c = row.createdAt;
      const claimedAt =
        c instanceof Date
          ? c.toISOString()
          : typeof c === 'string'
            ? c
            : new Date().toISOString();
      return {
        alreadyClaimed: true as const,
        claimedAt,
        referralCode: existing.referralCode,
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
      referralCode,
    };
  }

  async getReferralClaimForReferred(referredAddressRaw: string | undefined) {
    if (!referredAddressRaw || typeof referredAddressRaw !== 'string') {
      throw new BadRequestException('Invalid referredAddress');
    }
    const referredAddress = normalizeAddress(referredAddressRaw);
    if (!isEvmAddress(referredAddress)) {
      throw new BadRequestException('Invalid referredAddress');
    }

    const existing = await this.claimModel.findOne({ referredAddress }).lean();
    return {
      referralCode: existing?.referralCode ?? null,
    };
  }

  /**
   * directCount: referral claims you are the inviter for.
   * indirectCount: claims whose inviter is one of those direct referred wallets
   * (one hop from you; e.g. A→B→C→D and D→E: for A, indirect is C and D only, not E).
   */
  async getReferralCounts(inviterAddressRaw: string | undefined) {
    if (!inviterAddressRaw || typeof inviterAddressRaw !== 'string') {
      throw new BadRequestException('Invalid inviterAddress');
    }
    const inviterAddress = normalizeAddress(inviterAddressRaw);
    if (!isEvmAddress(inviterAddress)) {
      throw new BadRequestException('Invalid inviterAddress');
    }

    const directCount = await this.claimModel.countDocuments({
      inviterAddress,
    });

    let indirectCount = 0;
    if (directCount > 0) {
      const directReferred = await this.claimModel.distinct('referredAddress', {
        inviterAddress,
      });
      if (directReferred.length > 0) {
        indirectCount = await this.claimModel.countDocuments({
          inviterAddress: { $in: directReferred },
        });
      }
    }

    return { directCount, indirectCount };
  }
}
