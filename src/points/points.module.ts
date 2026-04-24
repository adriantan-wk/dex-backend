import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PointsController } from './points.controller';
import { PointsService } from './points.service';
import {
  PointsAccount,
  PointsAccountSchema,
} from './schemas/points-account.schema';
import { PointsDaily, PointsDailySchema } from './schemas/points-daily.schema';
import {
  PointsLedgerEntry,
  PointsLedgerEntrySchema,
} from './schemas/points-ledger-entry.schema';
import {
  PointsSeasonState,
  PointsSeasonStateSchema,
} from './schemas/points-season-state.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PointsAccount.name, schema: PointsAccountSchema },
      { name: PointsDaily.name, schema: PointsDailySchema },
      { name: PointsLedgerEntry.name, schema: PointsLedgerEntrySchema },
      { name: PointsSeasonState.name, schema: PointsSeasonStateSchema },
    ]),
  ],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
