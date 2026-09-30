var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
let ApiModule = class ApiModule {
};
ApiModule = __decorate([
    Module({
        imports: [ConfigModule, DatabaseModule],
        controllers: [HealthController, EventsController, StakePoolController, StakingController, IndexerController],
        providers: [EventsService, StakePoolService, IndexerService]
    })
], ApiModule);
export { ApiModule };
