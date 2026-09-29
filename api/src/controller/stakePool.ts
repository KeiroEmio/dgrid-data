import { Controller, Get, Param } from '@nestjs/common';
import { StakePoolService } from '../service/stakePool.js';

@Controller('stakePool')
export class StakePoolController {
  constructor(private readonly stakePoolService: StakePoolService) { }

  @Get('restakeReward/:day/sum')
  getRestakeRewardSum(@Param('day') day: string) {
    return this.stakePoolService.getRestakeRewardSum(day);
  }

  @Get('accpershareReward/get')
  getAccPerShareReward() {
    return this.stakePoolService.getAccPerShareReward();
  }

  @Get('accpershareReward/claimInfo/get')
  getAccPerShareRewardClaimInfo() {
    return this.stakePoolService.getAccPerShareRewardClaimInfo();
  }

  @Get('fixedRateReward/claimInfo/get')
  getFixedRateRewardClaimInfo() {
    return this.stakePoolService.getFixedRateRewardClaimInfo();
  }
}
