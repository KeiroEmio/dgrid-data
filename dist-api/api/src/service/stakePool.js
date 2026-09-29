var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, Injectable } from '@nestjs/common';
import { createPublicClient, formatUnits, http } from 'viem';
import { AppConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
const YEAR_SECONDS = BigInt(365 * 24 * 60 * 60);
const RATE_SCALE = BigInt(10000);
const RATE_180_BPS = BigInt(6000);
const RATE_360_BPS = BigInt(8000);
const UNIT = BigInt('1000000000000000000');
let StakePoolService = class StakePoolService {
    database;
    config;
    client;
    constructor(database, config) {
        this.database = database;
        this.config = config;
        this.client = createPublicClient({
            transport: http(config.rpcUrl)
        });
    }
    async getRestakeRewardSum(day) {
        if (!/^\d+$/.test(day)) {
            throw new BadRequestException('day must be a positive integer');
        }
        const result = await this.database.query(`select
        $1::numeric::text as day,
        coalesce(sum(amount), 0)::text as total_amount_raw,
        (coalesce(sum(amount), 0) / 1000000000000000000)::text as total_dgai,
        count(*)::integer as total_events,
        count(distinct user_address)::integer as total_users
      from dgai_staking_restake_reward_call_events
      where day = $1::numeric`, [day]);
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
        const result = await this.database.query(`select
        coalesce(sum(amount), 0)::text as claimed_net_raw,
        count(*)::integer as harvest_count
      from dgrid_stake_pool_harvest_events
      where lower(reward_token) = lower($1)`, [this.config.dgaiAddress]);
        const restakeResult = await this.database.query(`select
        coalesce(sum(amount) filter (where day = 180), 0)::text as restaked_180_raw,
        coalesce(sum(amount) filter (where day = 360), 0)::text as restaked_360_raw
      from dgai_staking_restake_reward_call_events`);
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
        const claimedResult = await this.database.query(`select coalesce(sum(amount), 0)::text as claimed_net_raw
      from dgai_staking_claim_events
      where day in (180, 360)`);
        const restakeResult = await this.database.query(`select
        coalesce(sum(amount) filter (where target_day = 180), 0)::text as restaked_180_raw,
        coalesce(sum(amount) filter (where target_day = 360), 0)::text as restaked_360_raw
      from dgai_staking_restake_dgai_events`);
        const walletCountsResult = await this.database.query(`with principal_by_wallet as (
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
        (select count(*)::integer from current_principal_by_wallet where amount > 0) as current_pending_wallets`);
        const principalResult = await this.database.query(`with unstake_by_request as (
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
      left join claim_unstake_by_request on claim_unstake_by_request.request_id = unstake_by_request.request_id`, [state.lastSettledTimestamp.toString()]);
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
    async updateFixedRateRewardState() {
        await this.ensureFixedRateTables();
        await this.database.query('select pg_advisory_lock($1)', [2026092901]);
        try {
            let state = await this.getOrCreateFixedRateState();
            const events = await this.getUnprocessedStakeRewardEvents(state);
            const timestampCache = new Map();
            for (const event of events) {
                const eventTimestamp = await this.getBlockTimestampCached(BigInt(event.block_number), timestampCache);
                state = await this.processDueReleases(state, eventTimestamp);
                state = this.settleFixedRateReward(state, eventTimestamp);
                const day = BigInt(event.day);
                const amount = BigInt(event.amount);
                if (event.event_name === 'Stake') {
                    state = this.addPrincipal(state, day, amount);
                }
                else if (event.release_time !== null) {
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
        }
        finally {
            await this.database.query('select pg_advisory_unlock($1)', [2026092901]);
        }
    }
    async ensureFixedRateTables() {
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
    async getFixedRateRewardState() {
        const result = await this.database.query(`select
        principal_180_raw::text,
        principal_360_raw::text,
        earned_raw::text,
        last_settled_timestamp::text,
        last_processed_block::text,
        last_processed_log_index
      from stake_fixed_rate_reward_state
      where id = 1`);
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
    async getOrCreateFixedRateState() {
        const startTimestamp = await this.getBlockTimestamp(this.config.dgridPoolDgaiRewardStartBlock);
        await this.database.query(`insert into stake_fixed_rate_reward_state (
        id,
        principal_180_raw,
        principal_360_raw,
        earned_raw,
        last_settled_timestamp,
        last_processed_block,
        last_processed_log_index
      ) values (1, 0, 0, 0, $1, 0, -1)
      on conflict (id) do nothing`, [startTimestamp.toString()]);
        const result = await this.database.query(`select
        principal_180_raw::text,
        principal_360_raw::text,
        earned_raw::text,
        last_settled_timestamp::text,
        last_processed_block::text,
        last_processed_log_index
      from stake_fixed_rate_reward_state
      where id = 1`);
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
    async getUnprocessedStakeRewardEvents(state) {
        const result = await this.database.query(`select * from (
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
      order by block_number::numeric asc, log_index asc`, [state.lastProcessedBlock.toString(), state.lastProcessedLogIndex]);
        return result.rows;
    }
    async insertPrincipalRelease(event) {
        await this.database.query(`insert into stake_fixed_rate_principal_releases (
        transaction_hash,
        log_index,
        day,
        amount,
        release_time
      ) values ($1, $2, $3, $4, $5)
      on conflict (transaction_hash, log_index) do nothing`, [event.transaction_hash, event.log_index, event.day, event.amount, event.release_time]);
    }
    async processDueReleases(state, timestamp) {
        const result = await this.database.query(`select id::text, day::text, amount::text, release_time::text
      from stake_fixed_rate_principal_releases
      where processed = false and release_time <= $1::numeric
      order by release_time asc, id asc`, [timestamp.toString()]);
        let nextState = state;
        for (const release of result.rows) {
            nextState = this.settleFixedRateReward(nextState, BigInt(release.release_time));
            nextState = this.subtractPrincipal(nextState, BigInt(release.day), BigInt(release.amount));
            await this.database.query('update stake_fixed_rate_principal_releases set processed = true where id = $1::bigint', [release.id]);
        }
        return nextState;
    }
    settleFixedRateReward(state, timestamp) {
        if (timestamp <= state.lastSettledTimestamp)
            return state;
        const deltaSeconds = timestamp - state.lastSettledTimestamp;
        const earned180Raw = (state.principal180Raw * RATE_180_BPS * deltaSeconds) / RATE_SCALE / YEAR_SECONDS;
        const earned360Raw = (state.principal360Raw * RATE_360_BPS * deltaSeconds) / RATE_SCALE / YEAR_SECONDS;
        return {
            ...state,
            earnedRaw: state.earnedRaw + earned180Raw + earned360Raw,
            lastSettledTimestamp: timestamp
        };
    }
    addPrincipal(state, day, amount) {
        if (day === BigInt(180)) {
            return { ...state, principal180Raw: state.principal180Raw + amount };
        }
        if (day === BigInt(360)) {
            return { ...state, principal360Raw: state.principal360Raw + amount };
        }
        return state;
    }
    subtractPrincipal(state, day, amount) {
        if (day === BigInt(180)) {
            return { ...state, principal180Raw: state.principal180Raw - amount };
        }
        if (day === BigInt(360)) {
            return { ...state, principal360Raw: state.principal360Raw - amount };
        }
        return state;
    }
    async saveFixedRateState(state) {
        await this.database.query(`update stake_fixed_rate_reward_state set
        principal_180_raw = $1,
        principal_360_raw = $2,
        earned_raw = $3,
        last_settled_timestamp = $4,
        last_processed_block = $5,
        last_processed_log_index = $6,
        updated_at = now()
      where id = 1`, [
            state.principal180Raw.toString(),
            state.principal360Raw.toString(),
            state.earnedRaw.toString(),
            state.lastSettledTimestamp.toString(),
            state.lastProcessedBlock.toString(),
            state.lastProcessedLogIndex
        ]);
    }
    async getLatestIndexedTimestamp() {
        const result = await this.database.query(`select greatest(next_from_block - 1, 0)::text as latest_indexed_block
      from block_indexer
      where indexer_name = 'DGridContracts'`);
        if (result.rowCount === 0)
            return null;
        const latestIndexedBlock = BigInt(result.rows[0].latest_indexed_block);
        if (latestIndexedBlock <= BigInt(0))
            return null;
        return this.getBlockTimestamp(latestIndexedBlock);
    }
    async getBlockTimestampCached(blockNumber, timestampCache) {
        const cacheKey = blockNumber.toString();
        const cachedTimestamp = timestampCache.get(cacheKey);
        if (cachedTimestamp !== undefined)
            return cachedTimestamp;
        const timestamp = await this.getBlockTimestamp(blockNumber);
        timestampCache.set(cacheKey, timestamp);
        return timestamp;
    }
    async getBlockTimestamp(blockNumber) {
        const cached = await this.database.query('select block_timestamp::text from block_timestamp_cache where block_number = $1::numeric', [blockNumber.toString()]);
        if ((cached.rowCount ?? 0) > 0) {
            return BigInt(cached.rows[0].block_timestamp);
        }
        const block = await this.client.getBlock({ blockNumber });
        const timestamp = block.timestamp;
        await this.database.query(`insert into block_timestamp_cache (block_number, block_timestamp)
      values ($1, $2)
      on conflict (block_number) do update set block_timestamp = excluded.block_timestamp`, [blockNumber.toString(), timestamp.toString()]);
        return timestamp;
    }
};
StakePoolService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService,
        AppConfigService])
], StakePoolService);
export { StakePoolService };
