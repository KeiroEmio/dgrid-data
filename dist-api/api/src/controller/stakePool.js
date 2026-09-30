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
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StakePoolService } from '../service/stakePool.js';
let StakePoolController = class StakePoolController {
    stakePoolService;
    constructor(stakePoolService) {
        this.stakePoolService = stakePoolService;
    }
    getRestakeRewardSum(day) {
        return this.stakePoolService.getRestakeRewardSum(day);
    }
    getAccPerShareReward() {
        return this.stakePoolService.getAccPerShareReward();
    }
    getAccPerShareRewardClaimInfo() {
        return this.stakePoolService.getAccPerShareRewardClaimInfo();
    }
    getFixedRateRewardClaimInfo() {
        return this.stakePoolService.getFixedRateRewardClaimInfo();
    }
    getMiningOverview() {
        return this.stakePoolService.getMiningOverview();
    }
    getMiningTrend(days, interval) {
        return this.stakePoolService.getMiningTrend({ days, interval });
    }
    getMiningFlows(wallet, action, day, limit, offset) {
        return this.stakePoolService.getMiningFlows({ wallet, action, day, limit, offset });
    }
};
__decorate([
    Get('restakeReward/:day/sum'),
    __param(0, Param('day')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], StakePoolController.prototype, "getRestakeRewardSum", null);
__decorate([
    Get('accpershareReward/get'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], StakePoolController.prototype, "getAccPerShareReward", null);
__decorate([
    Get('accpershareReward/claimInfo/get'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], StakePoolController.prototype, "getAccPerShareRewardClaimInfo", null);
__decorate([
    Get('fixedRateReward/claimInfo/get'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], StakePoolController.prototype, "getFixedRateRewardClaimInfo", null);
__decorate([
    ApiOperation({ summary: '挖矿统计总览' }),
    Get('mining/overview'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], StakePoolController.prototype, "getMiningOverview", null);
__decorate([
    ApiOperation({ summary: '挖矿收益趋势' }),
    ApiQuery({ name: 'days', required: false, example: '30' }),
    ApiQuery({ name: 'interval', required: false, example: 'day' }),
    Get('mining/trend'),
    __param(0, Query('days')),
    __param(1, Query('interval')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], StakePoolController.prototype, "getMiningTrend", null);
__decorate([
    ApiOperation({ summary: '挖矿收益流水' }),
    ApiQuery({ name: 'wallet', required: false }),
    ApiQuery({ name: 'action', required: false, example: 'claim' }),
    ApiQuery({ name: 'day', required: false, example: '180' }),
    ApiQuery({ name: 'limit', required: false, example: '50' }),
    ApiQuery({ name: 'offset', required: false, example: '0' }),
    Get('mining/flows'),
    __param(0, Query('wallet')),
    __param(1, Query('action')),
    __param(2, Query('day')),
    __param(3, Query('limit')),
    __param(4, Query('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], StakePoolController.prototype, "getMiningFlows", null);
StakePoolController = __decorate([
    ApiTags('stakePool'),
    Controller('stakePool'),
    __metadata("design:paramtypes", [StakePoolService])
], StakePoolController);
export { StakePoolController };
