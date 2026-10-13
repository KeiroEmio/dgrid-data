import { Pool } from 'pg';
import { DgaiStakingEventRepository } from './dgai-staking-event-repository.js';
import type { DgaiStakingEventEntity } from '../entities/index.js';
import type { IndexedEvent, EventStats } from '../types.js';

const YEAR_SECONDS = BigInt(365 * 24 * 60 * 60);
const RATE_SCALE = BigInt(10000);
const RATE_180_BPS = BigInt(6000);
const RATE_360_BPS = BigInt(9000);

type FixedRateState = {
  principal180Raw: bigint;
  principal360Raw: bigint;
  earnedRaw: bigint;
  lastSettledTimestamp: bigint;
  lastProcessedBlock: bigint;
  lastProcessedLogIndex: number;
};

type FixedRateRewardEvent = Extract<
  DgaiStakingEventEntity,
  { eventName: 'Stake' | 'Unstake' | 'CancelUnstake' | 'ChangeNode' }
>;

export class Database {
  private readonly pool: Pool;
  readonly dgaiStakingEvents: DgaiStakingEventRepository;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.dgaiStakingEvents = new DgaiStakingEventRepository(this.pool);
  }

  async migrate() {
    await this.dgaiStakingEvents.migrate();

    await this.pool.query(`
      create table if not exists chain_events (
        id bigserial primary key,
        contract_name text not null,
        contract_address text not null,
        event_name text not null,
        block_number numeric not null,
        transaction_hash text not null,
        log_index integer not null,
        args jsonb not null,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      create index if not exists chain_events_contract_event_idx
        on chain_events (contract_name, event_name);

      create index if not exists chain_events_block_number_idx
        on chain_events (block_number);

      create table if not exists event_stats (
        id bigserial primary key,
        contract_name text not null,
        event_name text not null,
        from_block numeric not null,
        to_block numeric not null,
        total_events integer not null,
        unique_users integer not null,
        total_amount numeric not null,
        updated_at timestamptz not null default now(),
        unique (contract_name, event_name, from_block, to_block)
      );

      create table if not exists block_indexer (
        indexer_name text primary key,
        next_from_block numeric not null,
        current_from_block numeric,
        current_to_block numeric,
        retry_count integer not null default 0,
        last_error text,
        updated_at timestamptz not null default now()
      );

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
        request_id numeric,
        staker text,
        node_id numeric,
        day numeric not null,
        amount numeric not null,
        release_time numeric not null,
        processed boolean not null default false,
        canceled boolean not null default false,
        canceled_by_transaction_hash text,
        canceled_by_log_index integer,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      alter table stake_fixed_rate_principal_releases
        add column if not exists request_id numeric,
        add column if not exists staker text,
        add column if not exists node_id numeric,
        add column if not exists canceled boolean not null default false,
        add column if not exists canceled_by_transaction_hash text,
        add column if not exists canceled_by_log_index integer;

      update stake_fixed_rate_principal_releases releases
      set
        request_id = unstake.request_id,
        staker = unstake.staker,
        node_id = unstake.node_id
      from dgai_staking_unstake_events unstake
      where releases.transaction_hash = unstake.transaction_hash
        and releases.log_index = unstake.log_index
        and releases.request_id is null;

      create index if not exists stake_fixed_rate_principal_releases_due_idx
        on stake_fixed_rate_principal_releases (processed, canceled, release_time);
      create index if not exists stake_fixed_rate_principal_releases_request_id_idx
        on stake_fixed_rate_principal_releases (request_id);
    `);
  }

  async saveEvents(events: IndexedEvent[]) {
    if (events.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const event of events) {
        await client.query(
          `insert into chain_events (
            contract_name,
            contract_address,
            event_name,
            block_number,
            transaction_hash,
            log_index,
            args
          ) values ($1, $2, $3, $4, $5, $6, $7)
          on conflict (transaction_hash, log_index) do update set
            contract_name = excluded.contract_name,
            contract_address = excluded.contract_address,
            event_name = excluded.event_name,
            block_number = excluded.block_number,
            args = excluded.args`,
          [
            event.contractName,
            event.contractAddress,
            event.eventName,
            event.blockNumber,
            event.transactionHash,
            event.logIndex,
            event.args
          ]
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveStats(stats: EventStats[]) {
    if (stats.length === 0) return;

    for (const item of stats) {
      await this.pool.query(
        `insert into event_stats (
          contract_name,
          event_name,
          from_block,
          to_block,
          total_events,
          unique_users,
          total_amount
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (contract_name, event_name, from_block, to_block) do update set
          total_events = excluded.total_events,
          unique_users = excluded.unique_users,
          total_amount = excluded.total_amount,
          updated_at = now()`,
        [
          item.contractName,
          item.eventName,
          item.fromBlock,
          item.toBlock,
          item.totalEvents,
          item.uniqueUsers,
          item.totalAmount
        ]
      );
    }
  }

  async getNextFromBlock(indexerName: string, defaultStartBlock: bigint) {
    const result = await this.pool.query<{ next_from_block: string }>(
      'select next_from_block from block_indexer where indexer_name = $1',
      [indexerName]
    );

    if (result.rowCount === 0) return defaultStartBlock;
    return BigInt(result.rows[0].next_from_block);
  }

  async markCrawlerFailure(indexerName: string, fromBlock: bigint, toBlock: bigint, error: unknown) {
    await this.pool.query(
      `insert into block_indexer (
        indexer_name,
        next_from_block,
        current_from_block,
        current_to_block,
        retry_count,
        last_error
      ) values ($1, $2, $3, $4, 1, $5)
      on conflict (indexer_name) do update set
        current_from_block = excluded.current_from_block,
        current_to_block = excluded.current_to_block,
        retry_count = block_indexer.retry_count + 1,
        last_error = excluded.last_error,
        updated_at = now()`,
      [indexerName, fromBlock.toString(), fromBlock.toString(), toBlock.toString(), error instanceof Error ? error.message : String(error)]
    );
  }

  async markCrawlerSuccess(indexerName: string, nextFromBlock: bigint) {
    await this.pool.query(
      `insert into block_indexer (
        indexer_name,
        next_from_block,
        current_from_block,
        current_to_block,
        retry_count,
        last_error
      ) values ($1, $2, null, null, 0, null)
      on conflict (indexer_name) do update set
        next_from_block = excluded.next_from_block,
        current_from_block = null,
        current_to_block = null,
        retry_count = 0,
        last_error = null,
        updated_at = now()`,
      [indexerName, nextFromBlock.toString()]
    );
  }

  async resetFixedRateRewardState(startBlock: bigint) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('truncate table stake_fixed_rate_reward_state, stake_fixed_rate_principal_releases restart identity');
      await client.query(
        `insert into block_indexer (indexer_name, next_from_block)
        values ('DGridContracts', $1)
        on conflict (indexer_name) do update set
          next_from_block = excluded.next_from_block,
          current_from_block = null,
          current_to_block = null,
          retry_count = 0,
          last_error = null,
          updated_at = now()`,
        [startBlock.toString()]
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateFixedRateRewardState(events: DgaiStakingEventEntity[], blockTimestamps: Map<string, bigint>) {
    const rewardEvents = events
      .filter((event): event is FixedRateRewardEvent =>
        event.eventName === 'Stake' ||
        event.eventName === 'Unstake' ||
        event.eventName === 'CancelUnstake' ||
        event.eventName === 'ChangeNode'
      )
      .filter((event) => event.day === '180' || event.day === '360')
      .sort((left, right) => {
        const blockDiff = BigInt(left.blockNumber) - BigInt(right.blockNumber);
        if (blockDiff < BigInt(0)) return -1;
        if (blockDiff > BigInt(0)) return 1;
        return left.logIndex - right.logIndex;
      });

    if (rewardEvents.length === 0) return;

    await this.pool.query('select pg_advisory_lock($1)', [2026092901]);
    try {
      let state = await this.getOrCreateFixedRateState(rewardEvents[0], blockTimestamps);

      for (const event of rewardEvents) {
        if (BigInt(event.blockNumber) < state.lastProcessedBlock) continue;
        if (BigInt(event.blockNumber) === state.lastProcessedBlock && event.logIndex <= state.lastProcessedLogIndex) continue;

        const eventTimestamp = this.requireBlockTimestamp(event.blockNumber, blockTimestamps);
        state = await this.processDueReleases(state, eventTimestamp);
        state = this.settleFixedRateReward(state, eventTimestamp);

        switch (event.eventName) {
          case 'Stake':
            state = this.addPrincipal(state, BigInt(event.day), BigInt(event.amount));
            break;
          case 'Unstake':
            await this.insertPrincipalRelease(event);
            state = await this.processDueReleases(state, eventTimestamp);
            break;
          case 'CancelUnstake':
            await this.cancelPrincipalReleases([event.cancelRequestId], event.staker, event.nodeId, event.transactionHash, event.logIndex);
            break;
          case 'ChangeNode':
            await this.cancelPrincipalReleases(event.cancelRequestIds, event.user, event.fromNodeId, event.transactionHash, event.logIndex);
            break;
        }

        state.lastProcessedBlock = BigInt(event.blockNumber);
        state.lastProcessedLogIndex = event.logIndex;
      }

      const latestTimestamp = [...blockTimestamps.values()].sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))[0];
      if (latestTimestamp !== undefined) {
        state = await this.processDueReleases(state, latestTimestamp);
        state = this.settleFixedRateReward(state, latestTimestamp);
      }

      await this.saveFixedRateState(state);
    } finally {
      await this.pool.query('select pg_advisory_unlock($1)', [2026092901]);
    }
  }

  private async getOrCreateFixedRateState(firstEvent: DgaiStakingEventEntity, blockTimestamps: Map<string, bigint>) {
    const startTimestamp = this.requireBlockTimestamp(firstEvent.blockNumber, blockTimestamps);

    await this.pool.query(
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

    const result = await this.pool.query<{
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

  private requireBlockTimestamp(blockNumber: string, blockTimestamps: Map<string, bigint>) {
    const timestamp = blockTimestamps.get(blockNumber);
    if (timestamp === undefined) throw new Error(`Missing block timestamp: ${blockNumber}`);
    return timestamp;
  }

  private async insertPrincipalRelease(event: Extract<DgaiStakingEventEntity, { eventName: 'Unstake' }>) {
    await this.pool.query(
      `insert into stake_fixed_rate_principal_releases (
        transaction_hash,
        log_index,
        request_id,
        staker,
        node_id,
        day,
        amount,
        release_time
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (transaction_hash, log_index) do update set
        request_id = excluded.request_id,
        staker = excluded.staker,
        node_id = excluded.node_id,
        day = excluded.day,
        amount = excluded.amount,
        release_time = excluded.release_time`,
      [
        event.transactionHash,
        event.logIndex,
        event.requestId,
        event.staker,
        event.nodeId,
        event.day,
        event.amount,
        event.releaseTime
      ]
    );
  }

  private async cancelPrincipalReleases(
    requestIds: string[],
    staker: string,
    nodeId: string,
    transactionHash: string,
    logIndex: number
  ) {
    if (requestIds.length === 0) return;

    await this.pool.query(
      `update stake_fixed_rate_principal_releases
      set
        canceled = true,
        canceled_by_transaction_hash = $4,
        canceled_by_log_index = $5
      where processed = false
        and canceled = false
        and request_id = any($1::numeric[])
        and lower(staker) = lower($2)
        and node_id = $3::numeric`,
      [requestIds, staker, nodeId, transactionHash, logIndex]
    );
  }

  private async processDueReleases(state: FixedRateState, timestamp: bigint) {
    const result = await this.pool.query<{ id: string; day: string; amount: string; release_time: string }>(
      `select id::text, day::text, amount::text, release_time::text
      from stake_fixed_rate_principal_releases
      where processed = false and canceled = false and release_time <= $1::numeric
      order by release_time asc, id asc`,
      [timestamp.toString()]
    );

    let nextState = state;
    for (const release of result.rows) {
      nextState = this.settleFixedRateReward(nextState, BigInt(release.release_time));
      nextState = this.subtractPrincipal(nextState, BigInt(release.day), BigInt(release.amount));
      await this.pool.query('update stake_fixed_rate_principal_releases set processed = true where id = $1::bigint', [release.id]);
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
    if (day === BigInt(180)) return { ...state, principal180Raw: state.principal180Raw + amount };
    if (day === BigInt(360)) return { ...state, principal360Raw: state.principal360Raw + amount };
    return state;
  }

  private subtractPrincipal(state: FixedRateState, day: bigint, amount: bigint): FixedRateState {
    if (day === BigInt(180)) return { ...state, principal180Raw: state.principal180Raw - amount };
    if (day === BigInt(360)) return { ...state, principal360Raw: state.principal360Raw - amount };
    return state;
  }

  private async saveFixedRateState(state: FixedRateState) {
    await this.pool.query(
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

  async close() {
    await this.pool.end();
  }
}
