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
import { Controller, Get, Param } from '@nestjs/common';
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
StakePoolController = __decorate([
    Controller('stakePool'),
    __metadata("design:paramtypes", [StakePoolService])
], StakePoolController);
export { StakePoolController };
