import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StakePoolService } from '../service/stakePool.js';

@ApiTags('stakePool')
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

  @ApiOperation({ summary: '挖矿统计总览' })
  @Get('mining/overview')
  getMiningOverview() {
    return this.stakePoolService.getMiningOverview();
  }

  @ApiOperation({ summary: '挖矿收益趋势' })
  @ApiQuery({ name: 'days', required: false, example: '30' })
  @ApiQuery({ name: 'interval', required: false, example: 'day' })
  @Get('mining/trend')
  getMiningTrend(
    @Query('days') days?: string,
    @Query('interval') interval?: string
  ) {
    return this.stakePoolService.getMiningTrend({ days, interval });
  }

  @ApiOperation({ summary: '挖矿收益流水' })
  @ApiQuery({ name: 'wallet', required: false })
  @ApiQuery({ name: 'action', required: false, example: 'claim' })
  @ApiQuery({ name: 'day', required: false, example: '180' })
  @ApiQuery({ name: 'limit', required: false, example: '50' })
  @ApiQuery({ name: 'offset', required: false, example: '0' })
  @Get('mining/flows')
  getMiningFlows(
    @Query('wallet') wallet?: string,
    @Query('action') action?: string,
    @Query('day') day?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.stakePoolService.getMiningFlows({ wallet, action, day, limit, offset });
  }
}
