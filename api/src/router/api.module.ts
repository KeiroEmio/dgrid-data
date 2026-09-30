import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { EventsController } from '../controller/events.js';
import { StakePoolController } from '../controller/stakePool.js';
import { StakingController } from '../controller/staking.js';
import { HealthController } from '../controller/health.js';
import { IndexerController } from '../controller/indexer.js';
import { EventsService } from '../service/events.js';
import { StakePoolService } from '../service/stakePool.js';
import { IndexerService } from '../service/indexer.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [HealthController, EventsController, StakePoolController, StakingController, IndexerController],
  providers: [EventsService, StakePoolService, IndexerService]
})
export class ApiModule { }
