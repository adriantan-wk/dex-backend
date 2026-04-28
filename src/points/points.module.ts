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
import {
  PointsIndexerState,
  PointsIndexerStateSchema,
} from './schemas/points-indexer-state.schema';
import { PointsCron } from './points.cron';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PointsAccount.name, schema: PointsAccountSchema },
      { name: PointsDaily.name, schema: PointsDailySchema },
      { name: PointsLedgerEntry.name, schema: PointsLedgerEntrySchema },
      { name: PointsSeasonState.name, schema: PointsSeasonStateSchema },
      { name: PointsIndexerState.name, schema: PointsIndexerStateSchema },
    ]),
  ],
  controllers: [PointsController],
  providers: [PointsService, PointsCron],
  exports: [PointsService],
})
export class PointsModule {}
