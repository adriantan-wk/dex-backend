import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MonitoringService } from './monitoring.service';
import { DexEvent, DexEventSchema } from './schemas/dex-event.schema';
import {
  IndexerState,
  IndexerStateSchema,
} from './schemas/indexer-state.schema';
import { PoolWatch, PoolWatchSchema } from './schemas/pool-watch.schema';
import { Swap, SwapSchema } from './schemas/swap.schema';
import { MonitoringController } from './monitoring.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IndexerState.name, schema: IndexerStateSchema },
      { name: DexEvent.name, schema: DexEventSchema },
      { name: PoolWatch.name, schema: PoolWatchSchema },
      { name: Swap.name, schema: SwapSchema },
    ]),
  ],
  controllers: [MonitoringController],
  providers: [MonitoringService],
})
export class MonitoringModule {}
