import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import {
  ReferralClaim,
  ReferralClaimSchema,
} from './schemas/referral-claim.schema';
import {
  ReferralCode,
  ReferralCodeSchema,
} from './schemas/referral-code.schema';
import {
  PointsLedgerEntry,
  PointsLedgerEntrySchema,
} from '../points/schemas/points-ledger-entry.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReferralClaim.name, schema: ReferralClaimSchema },
      { name: ReferralCode.name, schema: ReferralCodeSchema },
      { name: PointsLedgerEntry.name, schema: PointsLedgerEntrySchema },
    ]),
  ],
  controllers: [ReferralsController],
  providers: [ReferralsService],
})
export class ReferralsModule {}
