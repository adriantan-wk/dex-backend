import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FeesCron } from './fees.cron';
import {
  FeesIndexerState,
  FeesIndexerStateSchema,
} from './schemas/fees-indexer-state.schema';
import {
  FeesMasterTotal,
  FeesMasterTotalSchema,
} from './schemas/fees-master-total.schema';
import {
  FeesSnapshot,
  FeesSnapshotSchema,
} from './schemas/fees-snapshot.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FeesIndexerState.name, schema: FeesIndexerStateSchema },
      { name: FeesMasterTotal.name, schema: FeesMasterTotalSchema },
      { name: FeesSnapshot.name, schema: FeesSnapshotSchema },
    ]),
  ],
  providers: [FeesCron],
})
export class FeesModule {}
