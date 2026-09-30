var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StakePoolService } from '../service/stakePool.js';
let StakingController = class StakingController {
    stakePoolService;
    constructor(stakePoolService) {
        this.stakePoolService = stakePoolService;
    }
    getStakingOverview() {
        return this.stakePoolService.getStakingOverview();
    }
    getStakingTrend(days, interval) {
        return this.stakePoolService.getStakingTrend({ days, interval });
    }
    getStakingFlows(wallet, action, day, limit, offset) {
        return this.stakePoolService.getStakingFlows({ wallet, action, day, limit, offset });
    }
};
__decorate([
    ApiOperation({ summary: '质押收益统计总览' }),
    Get('overview'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], StakingController.prototype, "getStakingOverview", null);
__decorate([
    ApiOperation({ summary: '质押收益趋势' }),
    ApiQuery({ name: 'days', required: false, example: '30' }),
    ApiQuery({ name: 'interval', required: false, example: 'day' }),
    Get('trend'),
    __param(0, Query('days')),
    __param(1, Query('interval')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], StakingController.prototype, "getStakingTrend", null);
__decorate([
    ApiOperation({ summary: '质押收益流水' }),
    ApiQuery({ name: 'wallet', required: false }),
    ApiQuery({ name: 'action', required: false, example: 'stake' }),
    ApiQuery({ name: 'day', required: false, example: '180' }),
    ApiQuery({ name: 'limit', required: false, example: '50' }),
    ApiQuery({ name: 'offset', required: false, example: '0' }),
    Get('flows'),
    __param(0, Query('wallet')),
    __param(1, Query('action')),
    __param(2, Query('day')),
    __param(3, Query('limit')),
    __param(4, Query('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], StakingController.prototype, "getStakingFlows", null);
StakingController = __decorate([
    ApiTags('staking'),
    Controller('staking'),
    __metadata("design:paramtypes", [StakePoolService])
], StakingController);
export { StakingController };
