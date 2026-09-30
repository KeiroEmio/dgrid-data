import { BadRequestException, Injectable } from '@nestjs/common';
import { createPublicClient, formatUnits, http } from 'viem';
import { AppConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';

const YEAR_SECONDS = BigInt(365 * 24 * 60 * 60);
const RATE_SCALE = BigInt(10000);
const RATE_180_BPS = BigInt(6000);
const RATE_360_BPS = BigInt(8000);
const UNIT = BigInt('1000000000000000000');

type FixedRateState = {
  principal180Raw: bigint;
  principal360Raw: bigint;
  earnedRaw: bigint;
  lastSettledTimestamp: bigint;
  lastProcessedBlock: bigint;
  lastProcessedLogIndex: number;
};

type StakeRewardEvent = {
  event_name: 'Stake' | 'Unstake';
  block_number: string;
  log_index: number;
  transaction_hash: string;
  day: string;
  amount: string;
  release_time: string | null;
};

type MiningTrendQuery = {
  days?: string;
  interval?: string;
};

type MiningFlowsQuery = {
  wallet?: string;
  action?: string;
  day?: string;
  limit?: string;
  offset?: string;
};

type StakingTrendQuery = MiningTrendQuery;

type StakingFlowsQuery = MiningFlowsQuery;

@Injectable()
export class StakePoolService {
  private readonly client: ReturnType<typeof createPublicClient>;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: AppConfigService
  ) {
    this.client = createPublicClient({
      transport: http(config.rpcUrl)
    });
  }

  async getRestakeRewardSum(day: string) {
    if (!/^\d+$/.test(day)) {
      throw new BadRequestException('day must be a positive integer');
    }

    const result = await this.database.query(
      `select
        $1::numeric::text as day,
        coalesce(sum(amount), 0)::text as total_amount_raw,
        (coalesce(sum(amount), 0) / 1000000000000000000)::text as total_dgai,
        count(*)::integer as total_events,
        count(distinct user_address)::integer as total_users
      from dgai_staking_restake_reward_call_events
      where day = $1::numeric`,
      [day]
    );

    return result.rows[0];
  }

  async getAccPerShareReward() {
    const latestBlock = await this.client.getBlockNumber();
    const startBlock = this.config.dgridPoolDgaiRewardStartBlock;
    const rewardBlockCount = latestBlock > startBlock ? latestBlock - startBlock : BigInt(0);
    const totalRewardRaw = rewardBlockCount * this.config.dgridPoolPerBlockShare;

    return {
      from_block: startBlock.toString(),
      latest_block: latestBlock.toString(),
      reward_block_count: rewardBlockCount.toString(),
      per_block_share_raw: this.config.dgridPoolPerBlockShare.toString(),
      total_reward_raw: totalRewardRaw.toString(),
      total_dgai: formatUnits(totalRewardRaw, 18)
    };
  }

  async getAccPerShareRewardClaimInfo() {
    const reward = await this.getAccPerShareReward();
    const earnedRaw = BigInt(reward.total_reward_raw);

    const result = await this.database.query<{ claimed_net_raw: string; harvest_count: number }>(
      `select
        coalesce(sum(amount), 0)::text as claimed_net_raw,
        count(*)::integer as harvest_count
      from dgrid_stake_pool_harvest_events
      where lower(reward_token) = lower($1)`,
      [this.config.dgaiAddress]
    );
    const restakeResult = await this.database.query<{ restaked_180_raw: string; restaked_360_raw: string }>(
      `select
        coalesce(sum(amount) filter (where day = 180), 0)::text as restaked_180_raw,
        coalesce(sum(amount) filter (where day = 360), 0)::text as restaked_360_raw
      from dgai_staking_restake_reward_call_events`
    );

    const claimedNetRaw = BigInt(result.rows[0]?.claimed_net_raw ?? '0');
    const harvestCount = BigInt(result.rows[0]?.harvest_count ?? 0);
    const rewardFeeRaw = harvestCount * this.config.dgridPoolHarvestFeeRaw;
    const restaked180Raw = BigInt(restakeResult.rows[0]?.restaked_180_raw ?? '0');
    const restaked360Raw = BigInt(restakeResult.rows[0]?.restaked_360_raw ?? '0');
    const restakedTotalRaw = restaked180Raw + restaked360Raw;
    const pendingRaw = earnedRaw - claimedNetRaw - rewardFeeRaw - restakedTotalRaw;

    return {
      earnedRaw: earnedRaw.toString(),
      claimedNetRaw: claimedNetRaw.toString(),
      rewardFeeRaw: rewardFeeRaw.toString(),
      pendingRaw: pendingRaw.toString(),
      restaked180Raw: restaked180Raw.toString(),
      restaked360Raw: restaked360Raw.toString(),
      restakeConversionRate: earnedRaw === BigInt(0) ? '0' : formatUnits((restakedTotalRaw * UNIT) / earnedRaw, 18)
    };
  }

  async getFixedRateRewardClaimInfo() {
    await this.ensureFixedRateTables();
    const state = await this.getFixedRateRewardState();
    const earnedRaw = state.earnedRaw;

    const claimedResult = await this.database.query<{ claimed_net_raw: string }>(
      `select coalesce(sum(amount), 0)::text as claimed_net_raw
      from dgai_staking_claim_events
      where day in (180, 360)`
    );
    const restakeResult = await this.database.query<{ restaked_180_raw: string; restaked_360_raw: string }>(
      `select
        coalesce(sum(amount) filter (where target_day = 180), 0)::text as restaked_180_raw,
        coalesce(sum(amount) filter (where target_day = 360), 0)::text as restaked_360_raw
      from dgai_staking_restake_dgai_events`
    );
    const walletCountsResult = await this.database.query<{
      lifetime_reward_wallets: number;
      current_pending_wallets: number;
    }>(
      `with principal_by_wallet as (
        select staker as wallet, sum(amount) as amount
        from dgai_staking_stake_events
        where day in (180, 360)
        group by staker

        union all

        select staker as wallet, -sum(amount) as amount
        from dgai_staking_claim_unstake_events
        group by staker
      ), current_principal_by_wallet as (
        select wallet, sum(amount) as amount
        from principal_by_wallet
        group by wallet
      )
      select
        (select count(distinct staker)::integer from dgai_staking_stake_events where day in (180, 360)) as lifetime_reward_wallets,
        (select count(*)::integer from current_principal_by_wallet where amount > 0) as current_pending_wallets`
    );
    const principalResult = await this.database.query<{
      active_raw: string;
      unlocking_raw: string;
      withdrawable_raw: string;
    }>(
      `with unstake_by_request as (
        select request_id, max(release_time) as release_time, sum(amount) as amount
        from dgai_staking_unstake_events
        where day in (180, 360)
        group by request_id
      ), claim_unstake_by_request as (
        select request_id, sum(amount) as amount
        from dgai_staking_claim_unstake_events
        group by request_id
      )
      select
        (
          (select coalesce(sum(amount), 0) from dgai_staking_stake_events where day in (180, 360))
          -
          (select coalesce(sum(amount), 0) from dgai_staking_unstake_events where day in (180, 360))
        )::text as active_raw,
        coalesce(sum(greatest(unstake_by_request.amount - coalesce(claim_unstake_by_request.amount, 0), 0)) filter (where unstake_by_request.release_time > $1::numeric), 0)::text as unlocking_raw,
        coalesce(sum(greatest(unstake_by_request.amount - coalesce(claim_unstake_by_request.amount, 0), 0)) filter (where unstake_by_request.release_time <= $1::numeric), 0)::text as withdrawable_raw
      from unstake_by_request
      left join claim_unstake_by_request on claim_unstake_by_request.request_id = unstake_by_request.request_id`,
      [state.lastSettledTimestamp.toString()]
    );

    const claimedNetRaw = BigInt(claimedResult.rows[0]?.claimed_net_raw ?? '0');
    const restaked180Raw = BigInt(restakeResult.rows[0]?.restaked_180_raw ?? '0');
    const restaked360Raw = BigInt(restakeResult.rows[0]?.restaked_360_raw ?? '0');
    const restakedTotalRaw = restaked180Raw + restaked360Raw;
    const pendingRaw = earnedRaw - claimedNetRaw - restakedTotalRaw;
    const activeRaw = BigInt(principalResult.rows[0]?.active_raw ?? '0');
    const unlockingRaw = BigInt(principalResult.rows[0]?.unlocking_raw ?? '0');
    const withdrawableRaw = BigInt(principalResult.rows[0]?.withdrawable_raw ?? '0');
    const principalRaw = state.principal180Raw + state.principal360Raw;
    const restakeRate = earnedRaw === BigInt(0) ? '0' : formatUnits((restakedTotalRaw * UNIT) / earnedRaw, 18);

    return {
      earnedRaw: earnedRaw.toString(),
      claimedNetRaw: claimedNetRaw.toString(),
      pendingRaw: pendingRaw.toString(),
      restaked180Raw: restaked180Raw.toString(),
      restaked360Raw: restaked360Raw.toString(),
      restakeConversionRate: restakeRate,
      cumulativeRestakeRate: restakeRate,
      principalRaw: principalRaw.toString(),
      activeRaw: activeRaw.toString(),
      unlockingRaw: unlockingRaw.toString(),
      withdrawableRaw: withdrawableRaw.toString(),
      counts: {
        lifetimeRewardWallets: walletCountsResult.rows[0]?.lifetime_reward_wallets ?? 0,
        currentPendingWallets: walletCountsResult.rows[0]?.current_pending_wallets ?? 0
      }
    };
  }

  async getStakingOverview() {
    const claimInfo = await this.getFixedRateRewardClaimInfo();
    const nodeResult = await this.database.query<{ active_nodes: number }>(
      `with node_principal as (
        select node_id, sum(amount) as amount
        from dgai_staking_stake_events
        where day in (180, 360)
        group by node_id

        union all

        select node_id, -sum(amount) as amount
        from dgai_staking_unstake_events
        where day in (180, 360)
        group by node_id
      ), active_nodes as (
        select node_id
        from node_principal
        group by node_id
        having sum(amount) > 0
      )
      select count(*)::integer as active_nodes from active_nodes`
    );

    return {
      earnedRaw: claimInfo.earnedRaw,
      restaked180Raw: claimInfo.restaked180Raw,
      restaked360Raw: claimInfo.restaked360Raw,
      claimedNetRaw: claimInfo.claimedNetRaw,
      pendingRaw: claimInfo.pendingRaw,
      restakeConversionRate: claimInfo.restakeConversionRate,
      principalRaw: claimInfo.principalRaw,
      activeRaw: claimInfo.activeRaw,
      unlockingRaw: claimInfo.unlockingRaw,
      withdrawableRaw: claimInfo.withdrawableRaw,
      counts: {
        ...claimInfo.counts,
        activeStakingNodes: nodeResult.rows[0]?.active_nodes ?? 0
      }
    };
  }

  async getStakingTrend(query: StakingTrendQuery) {
    const days = Math.min(Math.max(Number(query.days ?? '30'), 1), 365);
    const interval = query.interval ?? 'day';
    if (interval !== 'day') {
      throw new BadRequestException('interval only supports day');
    }

    const result = await this.database.query<{
      date: string;
      claimed_net_raw: string;
      restaked_180_raw: string;
      restaked_360_raw: string;
      stake_raw: string;
      unstake_raw: string;
      claim_unstake_raw: string;
      claim_events: number;
      restake_events: number;
      stake_events: number;
      unstake_events: number;
      claim_unstake_events: number;
    }>(
      `with buckets as (
        select generate_series(
          date_trunc('day', now()) - (($1::integer - 1) * interval '1 day'),
          date_trunc('day', now()),
          interval '1 day'
        ) as bucket
      ), claim_daily as (
        select
          date_trunc('day', created_at) as bucket,
          sum(amount) as claimed_net_raw,
          count(*) as claim_events
        from dgai_staking_claim_events
        where day in (180, 360)
          and created_at >= date_trunc('day', now()) - (($1::integer - 1) * interval '1 day')
        group by date_trunc('day', created_at)
      ), restake_daily as (
        select
          date_trunc('day', created_at) as bucket,
          sum(amount) filter (where target_day = 180) as restaked_180_raw,
          sum(amount) filter (where target_day = 360) as restaked_360_raw,
          count(*) as restake_events
        from dgai_staking_restake_dgai_events
        where created_at >= date_trunc('day', now()) - (($1::integer - 1) * interval '1 day')
        group by date_trunc('day', created_at)
      ), stake_daily as (
        select
          date_trunc('day', created_at) as bucket,
          sum(amount) as stake_raw,
          count(*) as stake_events
        from dgai_staking_stake_events
        where day in (180, 360)
          and created_at >= date_trunc('day', now()) - (($1::integer - 1) * interval '1 day')
        group by date_trunc('day', created_at)
      ), unstake_daily as (
        select
          date_trunc('day', created_at) as bucket,
          sum(amount) as unstake_raw,
          count(*) as unstake_events
        from dgai_staking_unstake_events
        where day in (180, 360)
          and created_at >= date_trunc('day', now()) - (($1::integer - 1) * interval '1 day')
        group by date_trunc('day', created_at)
      ), claim_unstake_daily as (
        select
          date_trunc('day', created_at) as bucket,
          sum(amount) as claim_unstake_raw,
          count(*) as claim_unstake_events
        from dgai_staking_claim_unstake_events
        where created_at >= date_trunc('day', now()) - (($1::integer - 1) * interval '1 day')
        group by date_trunc('day', created_at)
      )
      select
        to_char(buckets.bucket, 'YYYY-MM-DD') as date,
        coalesce(claim_daily.claimed_net_raw, 0)::text as claimed_net_raw,
        coalesce(restake_daily.restaked_180_raw, 0)::text as restaked_180_raw,
        coalesce(restake_daily.restaked_360_raw, 0)::text as restaked_360_raw,
        coalesce(stake_daily.stake_raw, 0)::text as stake_raw,
        coalesce(unstake_daily.unstake_raw, 0)::text as unstake_raw,
        coalesce(claim_unstake_daily.claim_unstake_raw, 0)::text as claim_unstake_raw,
        coalesce(claim_daily.claim_events, 0)::integer as claim_events,
        coalesce(restake_daily.restake_events, 0)::integer as restake_events,
        coalesce(stake_daily.stake_events, 0)::integer as stake_events,
        coalesce(unstake_daily.unstake_events, 0)::integer as unstake_events,
        coalesce(claim_unstake_daily.claim_unstake_events, 0)::integer as claim_unstake_events
      from buckets
      left join claim_daily on claim_daily.bucket = buckets.bucket
      left join restake_daily on restake_daily.bucket = buckets.bucket
      left join stake_daily on stake_daily.bucket = buckets.bucket
      left join unstake_daily on unstake_daily.bucket = buckets.bucket
      left join claim_unstake_daily on claim_unstake_daily.bucket = buckets.bucket
      order by buckets.bucket asc`,
      [days]
    );

    return {
      interval,
      days,
      items: result.rows.map((row) => ({
        date: row.date,
        claimedNetRaw: row.claimed_net_raw,
        restaked180Raw: row.restaked_180_raw,
        restaked360Raw: row.restaked_360_raw,
        stakeRaw: row.stake_raw,
        unstakeRaw: row.unstake_raw,
        claimUnstakeRaw: row.claim_unstake_raw,
        claimEvents: row.claim_events,
        restakeEvents: row.restake_events,
        stakeEvents: row.stake_events,
        unstakeEvents: row.unstake_events,
        claimUnstakeEvents: row.claim_unstake_events
      }))
    };
  }

  async getStakingFlows(query: StakingFlowsQuery) {
    const limit = Math.min(Math.max(Number(query.limit ?? '50'), 1), 200);
    const offset = Math.max(Number(query.offset ?? '0'), 0);
    const values: unknown[] = [];
    const where: string[] = [];

    if (query.wallet) {
      values.push(query.wallet.toLowerCase());
      where.push(`lower(wallet) = $${values.length}`);
    }

    if (query.action) {
      values.push(query.action);
      where.push(`action = $${values.length}`);
    }

    if (query.day) {
      if (!/^\d+$/.test(query.day)) {
        throw new BadRequestException('day must be a positive integer');
      }
      values.push(query.day);
      where.push(`day = $${values.length}::numeric`);
    }

    values.push(limit);
    const limitIndex = values.length;
    values.push(offset);
    const offsetIndex = values.length;
    const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : '';

    const result = await this.database.query<{
      action: string;
      wallet: string;
      node_id: string | null;
      day: string | null;
      amount_raw: string;
      transaction_hash: string;
      block_number: string;
      log_index: number;
      created_at: Date;
    }>(
      `with flows as (
        select
          'stake'::text as action,
          staker as wallet,
          node_id,
          day,
          amount as amount_raw,
          transaction_hash,
          block_number,
          log_index,
          created_at
        from dgai_staking_stake_events
        where day in (180, 360)

        union all

        select
          'unstake'::text as action,
          staker as wallet,
          node_id,
          day,
          amount as amount_raw,
          transaction_hash,
          block_number,
          log_index,
          created_at
        from dgai_staking_unstake_events
        where day in (180, 360)

        union all

        select
          'claim'::text as action,
          staker as wallet,
          node_id,
          day,
          amount as amount_raw,
          transaction_hash,
          block_number,
          log_index,
          created_at
        from dgai_staking_claim_events
        where day in (180, 360)

        union all

        select
          'restake'::text as action,
          user_address as wallet,
          target_node_id as node_id,
          target_day as day,
          amount as amount_raw,
          transaction_hash,
          block_number,
          log_index,
          created_at
        from dgai_staking_restake_dgai_events

        union all

        select
          'claimUnstake'::text as action,
          staker as wallet,
          null::numeric as node_id,
          null::numeric as day,
          amount as amount_raw,
          transaction_hash,
          block_number,
          log_index,
          created_at
        from dgai_staking_claim_unstake_events
      )
      select
        action,
        wallet,
        node_id::text,
        day::text,
        amount_raw::text,
        transaction_hash,
        block_number::text,
        log_index,
        created_at
      from flows
      ${whereSql}
      order by block_number desc, log_index desc
      limit $${limitIndex} offset $${offsetIndex}`,
      values
    );

    return {
      limit,
      offset,
      items: result.rows.map((row) => ({
        action: row.action,
        wallet: row.wallet,
        nodeId: row.node_id,
        day: row.day,
        amountRaw: row.amount_raw,
        transactionHash: row.transaction_hash,
        blockNumber: row.block_number,
        logIndex: row.log_index,
        createdAt: row.created_at
      }))
    };
  }

  async getMiningOverview() {
    const claimInfo = await this.getAccPerShareRewardClaimInfo();
    const nodeResult = await this.database.query<{ active_nodes: number }>(
      `with node_principal as (
        select node_id, sum(amount) as amount
        from dgai_staking_stake_events
        where day in (180, 360)
        group by node_id

        union all

        select node_id, -sum(amount) as amount
        from dgai_staking_unstake_events
        where day in (180, 360)
        group by node_id
      ), active_nodes as (
        select node_id
        from node_principal
        group by node_id
        having sum(amount) > 0
      )
      select count(*)::integer as active_nodes from active_nodes`
    );
    const walletResult = await this.database.query<{
      lifetime_reward_wallets: number;
      current_pending_wallets: number;
    }>(
      `with reward_wallets as (
        select user_address as wallet, sum(amount) as claimed_raw
        from dgrid_stake_pool_harvest_events
        where lower(reward_token) = lower($1)
        group by user_address
      )
      select
        count(*)::integer as lifetime_reward_wallets,
        count(*) filter (where claimed_raw > 0)::integer as current_pending_wallets
      from reward_wallets`,
      [this.config.dgaiAddress]
    );

    return {
      earnedRaw: claimInfo.earnedRaw,
      restaked180Raw: claimInfo.restaked180Raw,
      restaked360Raw: claimInfo.restaked360Raw,
      claimedNetRaw: claimInfo.claimedNetRaw,
      rewardFeeRaw: claimInfo.rewardFeeRaw,
      pendingRaw: claimInfo.pendingRaw,
      restakeConversionRate: claimInfo.restakeConversionRate,
      counts: {
        lifetimeRewardWallets: walletResult.rows[0]?.lifetime_reward_wallets ?? 0,
        currentPendingWallets: walletResult.rows[0]?.current_pending_wallets ?? 0,
        activeMiningNodes: nodeResult.rows[0]?.active_nodes ?? 0
      }
    };
  }

  async getMiningTrend(query: MiningTrendQuery) {
    const days = Math.min(Math.max(Number(query.days ?? '30'), 1), 365);
    const interval = query.interval ?? 'day';
    if (interval !== 'day') {
      throw new BadRequestException('interval only supports day');
    }

    const result = await this.database.query<{
      date: string;
      claimed_net_raw: string;
      restaked_180_raw: string;
      restaked_360_raw: string;
      claimed_events: number;
      restake_events: number;
    }>(
      `with buckets as (
        select generate_series(
          date_trunc('day', now()) - (($1::integer - 1) * interval '1 day'),
          date_trunc('day', now()),
          interval '1 day'
        ) as bucket
      ), harvest_daily as (
        select
          date_trunc('day', created_at) as bucket,
          sum(amount) as claimed_net_raw,
          count(*) as claimed_events
        from dgrid_stake_pool_harvest_events
        where lower(reward_token) = lower($2)
          and created_at >= date_trunc('day', now()) - (($1::integer - 1) * interval '1 day')
        group by date_trunc('day', created_at)
      ), restake_daily as (
        select
          date_trunc('day', created_at) as bucket,
          sum(amount) filter (where day = 180) as restaked_180_raw,
          sum(amount) filter (where day = 360) as restaked_360_raw,
          count(*) as restake_events
        from dgai_staking_restake_reward_call_events
        where created_at >= date_trunc('day', now()) - (($1::integer - 1) * interval '1 day')
        group by date_trunc('day', created_at)
      )
      select
        to_char(buckets.bucket, 'YYYY-MM-DD') as date,
        coalesce(harvest_daily.claimed_net_raw, 0)::text as claimed_net_raw,
        coalesce(restake_daily.restaked_180_raw, 0)::text as restaked_180_raw,
        coalesce(restake_daily.restaked_360_raw, 0)::text as restaked_360_raw,
        coalesce(harvest_daily.claimed_events, 0)::integer as claimed_events,
        coalesce(restake_daily.restake_events, 0)::integer as restake_events
      from buckets
      left join harvest_daily on harvest_daily.bucket = buckets.bucket
      left join restake_daily on restake_daily.bucket = buckets.bucket
      order by buckets.bucket asc`,
      [days, this.config.dgaiAddress]
    );

    return {
      interval,
      days,
      items: result.rows.map((row) => ({
        date: row.date,
        claimedNetRaw: row.claimed_net_raw,
        restaked180Raw: row.restaked_180_raw,
        restaked360Raw: row.restaked_360_raw,
        claimedEvents: row.claimed_events,
        restakeEvents: row.restake_events
      }))
    };
  }

  async getMiningFlows(query: MiningFlowsQuery) {
    const limit = Math.min(Math.max(Number(query.limit ?? '50'), 1), 200);
    const offset = Math.max(Number(query.offset ?? '0'), 0);
    const values: unknown[] = [this.config.dgaiAddress];
    const where: string[] = [];

    if (query.wallet) {
      values.push(query.wallet.toLowerCase());
      where.push(`lower(wallet) = $${values.length}`);
    }

    if (query.action) {
      values.push(query.action);
      where.push(`action = $${values.length}`);
    }

    if (query.day) {
      if (!/^\d+$/.test(query.day)) {
        throw new BadRequestException('day must be a positive integer');
      }
      values.push(query.day);
      where.push(`day = $${values.length}::numeric`);
    }

    values.push(limit);
    const limitIndex = values.length;
    values.push(offset);
    const offsetIndex = values.length;
    const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : '';

    const result = await this.database.query<{
      action: string;
      wallet: string;
      day: string | null;
      amount_raw: string;
      fee_raw: string;
      transaction_hash: string;
      block_number: string;
      log_index: number;
      created_at: Date;
    }>(
      `with flows as (
        select
          'claim'::text as action,
          user_address as wallet,
          null::numeric as day,
          amount as amount_raw,
          0::numeric as fee_raw,
          transaction_hash,
          block_number,
          log_index,
          created_at
        from dgrid_stake_pool_harvest_events
        where lower(reward_token) = lower($1)

        union all

        select
          'restake'::text as action,
          user_address as wallet,
          day,
          amount as amount_raw,
          0::numeric as fee_raw,
          transaction_hash,
          block_number,
          log_index,
          created_at
        from dgai_staking_restake_reward_call_events
      )
      select
        action,
        wallet,
        day::text,
        amount_raw::text,
        fee_raw::text,
        transaction_hash,
        block_number::text,
        log_index,
        created_at
      from flows
      ${whereSql}
      order by block_number desc, log_index desc
      limit $${limitIndex} offset $${offsetIndex}`,
      values
    );

    return {
      limit,
      offset,
      items: result.rows.map((row) => ({
        action: row.action,
        wallet: row.wallet,
        day: row.day,
        amountRaw: row.amount_raw,
        feeRaw: row.fee_raw,
        transactionHash: row.transaction_hash,
        blockNumber: row.block_number,
        logIndex: row.log_index,
        createdAt: row.created_at
      }))
    };
  }

  private async updateFixedRateRewardState() {
    await this.ensureFixedRateTables();
    await this.database.query('select pg_advisory_lock($1)', [2026092901]);

    try {
      let state = await this.getOrCreateFixedRateState();
      const events = await this.getUnprocessedStakeRewardEvents(state);
      const timestampCache = new Map<string, bigint>();

      for (const event of events) {
        const eventTimestamp = await this.getBlockTimestampCached(BigInt(event.block_number), timestampCache);
        state = await this.processDueReleases(state, eventTimestamp);
        state = this.settleFixedRateReward(state, eventTimestamp);

        const day = BigInt(event.day);
        const amount = BigInt(event.amount);

        if (event.event_name === 'Stake') {
          state = this.addPrincipal(state, day, amount);
        } else if (event.release_time !== null) {
          await this.insertPrincipalRelease(event);
          state = await this.processDueReleases(state, eventTimestamp);
        }

        state.lastProcessedBlock = BigInt(event.block_number);
        state.lastProcessedLogIndex = event.log_index;
      }

      const indexedTimestamp = await this.getLatestIndexedTimestamp();
      if (indexedTimestamp !== null) {
        state = await this.processDueReleases(state, indexedTimestamp);
        state = this.settleFixedRateReward(state, indexedTimestamp);
      }

      await this.saveFixedRateState(state);
      return state;
    } finally {
      await this.database.query('select pg_advisory_unlock($1)', [2026092901]);
    }
  }

  private async ensureFixedRateTables() {
    await this.database.query(`
      create table if not exists stake_fixed_rate_reward_state (
        id integer primary key default 1,
        principal_180_raw numeric not null default 0,
        principal_360_raw numeric not null default 0,
        earned_raw numeric not null default 0,
        last_settled_timestamp numeric not null,
        last_processed_block numeric not null default 0,
        last_processed_log_index integer not null default -1,
        updated_at timestamptz not null default now()
      );

      create table if not exists stake_fixed_rate_principal_releases (
        id bigserial primary key,
        transaction_hash text not null,
        log_index integer not null,
        day numeric not null,
        amount numeric not null,
        release_time numeric not null,
        processed boolean not null default false,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      create index if not exists stake_fixed_rate_principal_releases_due_idx
        on stake_fixed_rate_principal_releases (processed, release_time);

      create table if not exists block_timestamp_cache (
        block_number numeric primary key,
        block_timestamp numeric not null,
        created_at timestamptz not null default now()
      );
    `);
  }

  private async getFixedRateRewardState() {
    const result = await this.database.query<{
      principal_180_raw: string;
      principal_360_raw: string;
      earned_raw: string;
      last_settled_timestamp: string;
      last_processed_block: string;
      last_processed_log_index: number;
    }>(
      `select
        principal_180_raw::text,
        principal_360_raw::text,
        earned_raw::text,
        last_settled_timestamp::text,
        last_processed_block::text,
        last_processed_log_index
      from stake_fixed_rate_reward_state
      where id = 1`
    );

    if ((result.rowCount ?? 0) === 0) {
      return {
        principal180Raw: BigInt(0),
        principal360Raw: BigInt(0),
        earnedRaw: BigInt(0),
        lastSettledTimestamp: BigInt(0),
        lastProcessedBlock: BigInt(0),
        lastProcessedLogIndex: -1
      };
    }

    const row = result.rows[0];
    return {
      principal180Raw: BigInt(row.principal_180_raw),
      principal360Raw: BigInt(row.principal_360_raw),
      earnedRaw: BigInt(row.earned_raw),
      lastSettledTimestamp: BigInt(row.last_settled_timestamp),
      lastProcessedBlock: BigInt(row.last_processed_block),
      lastProcessedLogIndex: row.last_processed_log_index
    };
  }

  private async getOrCreateFixedRateState() {
    const startTimestamp = await this.getBlockTimestamp(this.config.dgridPoolDgaiRewardStartBlock);

    await this.database.query(
      `insert into stake_fixed_rate_reward_state (
        id,
        principal_180_raw,
        principal_360_raw,
        earned_raw,
        last_settled_timestamp,
        last_processed_block,
        last_processed_log_index
      ) values (1, 0, 0, 0, $1, 0, -1)
      on conflict (id) do nothing`,
      [startTimestamp.toString()]
    );

    const result = await this.database.query<{
      principal_180_raw: string;
      principal_360_raw: string;
      earned_raw: string;
      last_settled_timestamp: string;
      last_processed_block: string;
      last_processed_log_index: number;
    }>(
      `select
        principal_180_raw::text,
        principal_360_raw::text,
        earned_raw::text,
        last_settled_timestamp::text,
        last_processed_block::text,
        last_processed_log_index
      from stake_fixed_rate_reward_state
      where id = 1`
    );

    const row = result.rows[0];
    return {
      principal180Raw: BigInt(row.principal_180_raw),
      principal360Raw: BigInt(row.principal_360_raw),
      earnedRaw: BigInt(row.earned_raw),
      lastSettledTimestamp: BigInt(row.last_settled_timestamp),
      lastProcessedBlock: BigInt(row.last_processed_block),
      lastProcessedLogIndex: row.last_processed_log_index
    };
  }

  private async getUnprocessedStakeRewardEvents(state: FixedRateState) {
    const result = await this.database.query<StakeRewardEvent>(
      `select * from (
        select
          'Stake'::text as event_name,
          block_number::text,
          log_index,
          transaction_hash,
          day::text,
          amount::text,
          null::text as release_time
        from dgai_staking_stake_events
        where day in (180, 360)
          and (block_number > $1::numeric or (block_number = $1::numeric and log_index > $2::integer))

        union all

        select
          'Unstake'::text as event_name,
          block_number::text,
          log_index,
          transaction_hash,
          day::text,
          amount::text,
          release_time::text
        from dgai_staking_unstake_events
        where day in (180, 360)
          and (block_number > $1::numeric or (block_number = $1::numeric and log_index > $2::integer))
      ) events
      order by block_number::numeric asc, log_index asc`,
      [state.lastProcessedBlock.toString(), state.lastProcessedLogIndex]
    );

    return result.rows;
  }

  private async insertPrincipalRelease(event: StakeRewardEvent) {
    await this.database.query(
      `insert into stake_fixed_rate_principal_releases (
        transaction_hash,
        log_index,
        day,
        amount,
        release_time
      ) values ($1, $2, $3, $4, $5)
      on conflict (transaction_hash, log_index) do nothing`,
      [event.transaction_hash, event.log_index, event.day, event.amount, event.release_time]
    );
  }

  private async processDueReleases(state: FixedRateState, timestamp: bigint) {
    const result = await this.database.query<{ id: string; day: string; amount: string; release_time: string }>(
      `select id::text, day::text, amount::text, release_time::text
      from stake_fixed_rate_principal_releases
      where processed = false and release_time <= $1::numeric
      order by release_time asc, id asc`,
      [timestamp.toString()]
    );

    let nextState = state;
    for (const release of result.rows) {
      nextState = this.settleFixedRateReward(nextState, BigInt(release.release_time));
      nextState = this.subtractPrincipal(nextState, BigInt(release.day), BigInt(release.amount));
      await this.database.query('update stake_fixed_rate_principal_releases set processed = true where id = $1::bigint', [release.id]);
    }

    return nextState;
  }

  private settleFixedRateReward(state: FixedRateState, timestamp: bigint): FixedRateState {
    if (timestamp <= state.lastSettledTimestamp) return state;

    const deltaSeconds = timestamp - state.lastSettledTimestamp;
    const earned180Raw = (state.principal180Raw * RATE_180_BPS * deltaSeconds) / RATE_SCALE / YEAR_SECONDS;
    const earned360Raw = (state.principal360Raw * RATE_360_BPS * deltaSeconds) / RATE_SCALE / YEAR_SECONDS;

    return {
      ...state,
      earnedRaw: state.earnedRaw + earned180Raw + earned360Raw,
      lastSettledTimestamp: timestamp
    };
  }

  private addPrincipal(state: FixedRateState, day: bigint, amount: bigint): FixedRateState {
    if (day === BigInt(180)) {
      return { ...state, principal180Raw: state.principal180Raw + amount };
    }

    if (day === BigInt(360)) {
      return { ...state, principal360Raw: state.principal360Raw + amount };
    }

    return state;
  }

  private subtractPrincipal(state: FixedRateState, day: bigint, amount: bigint): FixedRateState {
    if (day === BigInt(180)) {
      return { ...state, principal180Raw: state.principal180Raw - amount };
    }

    if (day === BigInt(360)) {
      return { ...state, principal360Raw: state.principal360Raw - amount };
    }

    return state;
  }

  private async saveFixedRateState(state: FixedRateState) {
    await this.database.query(
      `update stake_fixed_rate_reward_state set
        principal_180_raw = $1,
        principal_360_raw = $2,
        earned_raw = $3,
        last_settled_timestamp = $4,
        last_processed_block = $5,
        last_processed_log_index = $6,
        updated_at = now()
      where id = 1`,
      [
        state.principal180Raw.toString(),
        state.principal360Raw.toString(),
        state.earnedRaw.toString(),
        state.lastSettledTimestamp.toString(),
        state.lastProcessedBlock.toString(),
        state.lastProcessedLogIndex
      ]
    );
  }

  private async getLatestIndexedTimestamp() {
    const result = await this.database.query<{ latest_indexed_block: string }>(
      `select greatest(next_from_block - 1, 0)::text as latest_indexed_block
      from block_indexer
      where indexer_name = 'DGridContracts'`
    );

    if (result.rowCount === 0) return null;

    const latestIndexedBlock = BigInt(result.rows[0].latest_indexed_block);
    if (latestIndexedBlock <= BigInt(0)) return null;

    return this.getBlockTimestamp(latestIndexedBlock);
  }

  private async getBlockTimestampCached(blockNumber: bigint, timestampCache: Map<string, bigint>) {
    const cacheKey = blockNumber.toString();
    const cachedTimestamp = timestampCache.get(cacheKey);
    if (cachedTimestamp !== undefined) return cachedTimestamp;

    const timestamp = await this.getBlockTimestamp(blockNumber);
    timestampCache.set(cacheKey, timestamp);
    return timestamp;
  }

  private async getBlockTimestamp(blockNumber: bigint) {
    const cached = await this.database.query<{ block_timestamp: string }>(
      'select block_timestamp::text from block_timestamp_cache where block_number = $1::numeric',
      [blockNumber.toString()]
    );

    if ((cached.rowCount ?? 0) > 0) {
      return BigInt(cached.rows[0].block_timestamp);
    }

    const block = await this.client.getBlock({ blockNumber });
    const timestamp = block.timestamp;

    await this.database.query(
      `insert into block_timestamp_cache (block_number, block_timestamp)
      values ($1, $2)
      on conflict (block_number) do update set block_timestamp = excluded.block_timestamp`,
      [blockNumber.toString(), timestamp.toString()]
    );

    return timestamp;
  }
}
