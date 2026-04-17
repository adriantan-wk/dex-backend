import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MonitoringService } from './monitoring.service';
import { DexEvent, DexEventSchema } from './schemas/dex-event.schema';
import {
  IndexerState,
  IndexerStateSchema,
} from './schemas/indexer-state.schema';
import { PoolWatch, PoolWatchSchema } from './schemas/pool-watch.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IndexerState.name, schema: IndexerStateSchema },
      { name: DexEvent.name, schema: DexEventSchema },
      { name: PoolWatch.name, schema: PoolWatchSchema },
    ]),
  ],
  providers: [MonitoringService],
})
export class MonitoringModule {}
