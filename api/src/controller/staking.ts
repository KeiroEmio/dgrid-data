import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StakePoolService } from '../service/stakePool.js';

@ApiTags('staking')
@Controller('staking')
export class StakingController {
  constructor(private readonly stakePoolService: StakePoolService) { }

  @ApiOperation({ summary: '质押收益统计总览' })
  @Get('overview')
  getStakingOverview() {
    return this.stakePoolService.getStakingOverview();
  }

  @ApiOperation({ summary: '质押收益趋势' })
  @ApiQuery({ name: 'days', required: false, example: '30' })
  @ApiQuery({ name: 'interval', required: false, example: 'day' })
  @Get('trend')
  getStakingTrend(
    @Query('days') days?: string,
    @Query('interval') interval?: string
  ) {
    return this.stakePoolService.getStakingTrend({ days, interval });
  }

  @ApiOperation({ summary: '质押收益流水' })
  @ApiQuery({ name: 'wallet', required: false })
  @ApiQuery({ name: 'action', required: false, example: 'stake' })
  @ApiQuery({ name: 'day', required: false, example: '180' })
  @ApiQuery({ name: 'limit', required: false, example: '50' })
  @ApiQuery({ name: 'offset', required: false, example: '0' })
  @Get('flows')
  getStakingFlows(
    @Query('wallet') wallet?: string,
    @Query('action') action?: string,
    @Query('day') day?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.stakePoolService.getStakingFlows({ wallet, action, day, limit, offset });
  }
}
