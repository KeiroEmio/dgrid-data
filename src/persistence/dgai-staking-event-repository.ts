import type { Pool, PoolClient } from 'pg';
import type {
  CancelUnstakeEventEntity,
  ChangeNodeEventEntity,
  ClaimEventEntity,
  ClaimUnstakeEventEntity,
  DgaiStakingEventEntity,
  HarvestEventEntity,
  RestakeDgaiEventEntity,
  RestakeRewardCallEventEntity,
  StakeEventEntity,
  UnstakeEventEntity
} from '../entities/index.js';

export class DgaiStakingEventRepository {
  constructor(private readonly pool: Pool) { }

  async migrate() {
    await this.pool.query(`
      create table if not exists dgai_staking_stake_events (
        id bigserial primary key,
        contract_address text not null,
        block_number numeric not null,
        transaction_hash text not null,
        log_index integer not null,
        node_id numeric not null,
        staker text not null,
        day numeric not null,
        amount numeric not null,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      create index if not exists dgai_staking_stake_events_staker_idx
        on dgai_staking_stake_events (staker);
      create index if not exists dgai_staking_stake_events_node_id_idx
        on dgai_staking_stake_events (node_id);

      create table if not exists dgai_staking_unstake_events (
        id bigserial primary key,
        contract_address text not null,
        block_number numeric not null,
        transaction_hash text not null,
        log_index integer not null,
        node_id numeric not null,
        staker text not null,
        request_id numeric not null,
        day numeric not null,
        amount numeric not null,
        release_time numeric not null,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      create index if not exists dgai_staking_unstake_events_staker_idx
        on dgai_staking_unstake_events (staker);
      create index if not exists dgai_staking_unstake_events_request_id_idx
        on dgai_staking_unstake_events (request_id);

      create table if not exists dgai_staking_claim_events (
        id bigserial primary key,
        contract_address text not null,
        block_number numeric not null,
        transaction_hash text not null,
        log_index integer not null,
        node_id numeric not null,
        staker text not null,
        day numeric not null,
        amount numeric not null,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      create index if not exists dgai_staking_claim_events_staker_idx
        on dgai_staking_claim_events (staker);
      create index if not exists dgai_staking_claim_events_node_id_idx
        on dgai_staking_claim_events (node_id);

      create table if not exists dgai_staking_claim_unstake_events (
        id bigserial primary key,
        contract_address text not null,
        block_number numeric not null,
        transaction_hash text not null,
        log_index integer not null,
        staker text not null,
        request_id numeric not null,
        amount numeric not null,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      create index if not exists dgai_staking_claim_unstake_events_staker_idx
        on dgai_staking_claim_unstake_events (staker);
      create index if not exists dgai_staking_claim_unstake_events_request_id_idx
        on dgai_staking_claim_unstake_events (request_id);

      create table if not exists dgai_staking_cancel_unstake_events (
        id bigserial primary key,
        contract_address text not null,
        block_number numeric not null,
        transaction_hash text not null,
        log_index integer not null,
        staker text not null,
        cancel_request_id numeric not null,
        day numeric not null,
        amount numeric not null,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      create index if not exists dgai_staking_cancel_unstake_events_staker_idx
        on dgai_staking_cancel_unstake_events (staker);
      create index if not exists dgai_staking_cancel_unstake_events_request_id_idx
        on dgai_staking_cancel_unstake_events (cancel_request_id);

      create table if not exists dgai_staking_change_node_events (
        id bigserial primary key,
        contract_address text not null,
        block_number numeric not null,
        transaction_hash text not null,
        log_index integer not null,
        user_address text not null,
        from_node_id numeric not null,
        to_node_id numeric not null,
        day numeric not null,
        amount numeric not null,
        canceled_pending_unstake numeric not null,
        cancel_request_ids jsonb not null,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      create index if not exists dgai_staking_change_node_events_user_idx
        on dgai_staking_change_node_events (user_address);
      create index if not exists dgai_staking_change_node_events_from_node_idx
        on dgai_staking_change_node_events (from_node_id);
      create index if not exists dgai_staking_change_node_events_to_node_idx
        on dgai_staking_change_node_events (to_node_id);

      create table if not exists dgai_staking_restake_reward_call_events (
        id bigserial primary key,
        contract_address text not null,
        block_number numeric not null,
        transaction_hash text not null,
        log_index integer not null,
        user_address text not null,
        select_node_id numeric not null,
        day numeric not null,
        amount numeric not null,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      create index if not exists dgai_staking_restake_reward_call_events_user_idx
        on dgai_staking_restake_reward_call_events (user_address);

      create table if not exists dgai_staking_restake_dgai_events (
        id bigserial primary key,
        contract_address text not null,
        block_number numeric not null,
        transaction_hash text not null,
        log_index integer not null,
        user_address text not null,
        source_node_id numeric not null,
        source_day numeric not null,
        target_node_id numeric not null,
        target_day numeric not null,
        amount numeric not null,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      create index if not exists dgai_staking_restake_dgai_events_user_idx
        on dgai_staking_restake_dgai_events (user_address);

      create table if not exists dgrid_stake_pool_harvest_events (
        id bigserial primary key,
        contract_address text not null,
        block_number numeric not null,
        transaction_hash text not null,
        log_index integer not null,
        user_address text not null,
        amount numeric not null,
        reward_token text not null,
        created_at timestamptz not null default now(),
        unique (transaction_hash, log_index)
      );

      create index if not exists dgrid_stake_pool_harvest_events_user_idx
        on dgrid_stake_pool_harvest_events (user_address);
      create index if not exists dgrid_stake_pool_harvest_events_reward_token_idx
        on dgrid_stake_pool_harvest_events (reward_token);

      alter table dgai_staking_stake_events add column if not exists block_timestamp numeric;
      alter table dgai_staking_unstake_events add column if not exists block_timestamp numeric;
      alter table dgai_staking_claim_events add column if not exists block_timestamp numeric;
      alter table dgai_staking_claim_unstake_events add column if not exists block_timestamp numeric;
      alter table dgai_staking_cancel_unstake_events add column if not exists block_timestamp numeric;
      alter table dgai_staking_change_node_events add column if not exists block_timestamp numeric;
      alter table dgai_staking_restake_reward_call_events add column if not exists block_timestamp numeric;
      alter table dgai_staking_restake_dgai_events add column if not exists block_timestamp numeric;
      alter table dgrid_stake_pool_harvest_events add column if not exists block_timestamp numeric;
    `);
  }

  async saveMany(events: DgaiStakingEventEntity[]) {
    if (events.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const event of events) {
        await this.saveOne(client, event);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async saveOne(client: PoolClient, event: DgaiStakingEventEntity) {
    switch (event.eventName) {
      case 'Stake':
        await this.saveStake(client, event);
        return;
      case 'Unstake':
        await this.saveUnstake(client, event);
        return;
      case 'Claim':
        await this.saveClaim(client, event);
        return;
      case 'ClaimUnstake':
        await this.saveClaimUnstake(client, event);
        return;
      case 'CancelUnstake':
        await this.saveCancelUnstake(client, event);
        return;
      case 'ChangeNode':
        await this.saveChangeNode(client, event);
        return;
      case 'RestakeRewardCall':
        await this.saveRestakeRewardCall(client, event);
        return;
      case 'RestakeDGAI':
        await this.saveRestakeDgai(client, event);
        return;
      case 'Harvest':
        await this.saveHarvest(client, event);
        return;
    }
  }

  private async saveStake(client: PoolClient, event: StakeEventEntity) {
    await client.query(
      `insert into dgai_staking_stake_events (
        contract_address, block_number, transaction_hash, log_index, node_id, staker, day, amount, block_timestamp, is_handle_pre_stake
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (transaction_hash, log_index) do update set
        contract_address = excluded.contract_address,
        block_number = excluded.block_number,
        node_id = excluded.node_id,
        staker = excluded.staker,
        day = excluded.day,
        amount = excluded.amount,
        block_timestamp = excluded.block_timestamp,
        is_handle_pre_stake = dgai_staking_stake_events.is_handle_pre_stake or excluded.is_handle_pre_stake`,
      [event.contractAddress, event.blockNumber, event.transactionHash, event.logIndex, event.nodeId, event.staker, event.day, event.amount, event.blockTimestamp, event.isHandlePreStake]
    );
  }

  private async saveUnstake(client: PoolClient, event: UnstakeEventEntity) {
    await client.query(
      `insert into dgai_staking_unstake_events (
        contract_address, block_number, transaction_hash, log_index, node_id, staker, request_id, day, amount, release_time, block_timestamp
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      on conflict (transaction_hash, log_index) do update set
        contract_address = excluded.contract_address,
        block_number = excluded.block_number,
        node_id = excluded.node_id,
        staker = excluded.staker,
        request_id = excluded.request_id,
        day = excluded.day,
        amount = excluded.amount,
        release_time = excluded.release_time,
        block_timestamp = excluded.block_timestamp`,
      [
        event.contractAddress,
        event.blockNumber,
        event.transactionHash,
        event.logIndex,
        event.nodeId,
        event.staker,
        event.requestId,
        event.day,
        event.amount,
        event.releaseTime,
        event.blockTimestamp
      ]
    );
  }

  private async saveClaim(client: PoolClient, event: ClaimEventEntity) {
    await client.query(
      `insert into dgai_staking_claim_events (
        contract_address, block_number, transaction_hash, log_index, node_id, staker, day, amount, block_timestamp
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (transaction_hash, log_index) do update set
        contract_address = excluded.contract_address,
        block_number = excluded.block_number,
        node_id = excluded.node_id,
        staker = excluded.staker,
        day = excluded.day,
        amount = excluded.amount,
        block_timestamp = excluded.block_timestamp`,
      [event.contractAddress, event.blockNumber, event.transactionHash, event.logIndex, event.nodeId, event.staker, event.day, event.amount, event.blockTimestamp]
    );
  }

  private async saveClaimUnstake(client: PoolClient, event: ClaimUnstakeEventEntity) {
    await client.query(
      `insert into dgai_staking_claim_unstake_events (
        contract_address, block_number, transaction_hash, log_index, staker, request_id, amount, block_timestamp
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (transaction_hash, log_index) do update set
        contract_address = excluded.contract_address,
        block_number = excluded.block_number,
        staker = excluded.staker,
        request_id = excluded.request_id,
        amount = excluded.amount,
        block_timestamp = excluded.block_timestamp`,
      [event.contractAddress, event.blockNumber, event.transactionHash, event.logIndex, event.staker, event.requestId, event.amount, event.blockTimestamp]
    );
  }

  private async saveCancelUnstake(client: PoolClient, event: CancelUnstakeEventEntity) {
    await client.query(
      `insert into dgai_staking_cancel_unstake_events (
        contract_address, block_number, transaction_hash, log_index, staker, cancel_request_id, day, amount, block_timestamp
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (transaction_hash, log_index) do update set
        contract_address = excluded.contract_address,
        block_number = excluded.block_number,
        staker = excluded.staker,
        cancel_request_id = excluded.cancel_request_id,
        day = excluded.day,
        amount = excluded.amount,
        block_timestamp = excluded.block_timestamp`,
      [
        event.contractAddress,
        event.blockNumber,
        event.transactionHash,
        event.logIndex,
        event.staker,
        event.cancelRequestId,
        event.day,
        event.amount,
        event.blockTimestamp
      ]
    );
  }

  private async saveChangeNode(client: PoolClient, event: ChangeNodeEventEntity) {
    await client.query(
      `insert into dgai_staking_change_node_events (
        contract_address,
        block_number,
        transaction_hash,
        log_index,
        user_address,
        from_node_id,
        to_node_id,
        day,
        amount,
        canceled_pending_unstake,
        cancel_request_ids,
        block_timestamp
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      on conflict (transaction_hash, log_index) do update set
        contract_address = excluded.contract_address,
        block_number = excluded.block_number,
        user_address = excluded.user_address,
        from_node_id = excluded.from_node_id,
        to_node_id = excluded.to_node_id,
        day = excluded.day,
        amount = excluded.amount,
        canceled_pending_unstake = excluded.canceled_pending_unstake,
        cancel_request_ids = excluded.cancel_request_ids,
        block_timestamp = excluded.block_timestamp`,
      [
        event.contractAddress,
        event.blockNumber,
        event.transactionHash,
        event.logIndex,
        event.user,
        event.fromNodeId,
        event.toNodeId,
        event.day,
        event.amount,
        event.canceledPendingUnstake,
        JSON.stringify(event.cancelRequestIds),
        event.blockTimestamp
      ]
    );
  }

  private async saveRestakeRewardCall(client: PoolClient, event: RestakeRewardCallEventEntity) {
    await client.query(
      `insert into dgai_staking_restake_reward_call_events (
        contract_address, block_number, transaction_hash, log_index, user_address, select_node_id, day, amount, block_timestamp
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (transaction_hash, log_index) do update set
        contract_address = excluded.contract_address,
        block_number = excluded.block_number,
        user_address = excluded.user_address,
        select_node_id = excluded.select_node_id,
        day = excluded.day,
        amount = excluded.amount,
        block_timestamp = excluded.block_timestamp`,
      [
        event.contractAddress,
        event.blockNumber,
        event.transactionHash,
        event.logIndex,
        event.user,
        event.selectNodeId,
        event.day,
        event.amount,
        event.blockTimestamp
      ]
    );
  }

  private async saveRestakeDgai(client: PoolClient, event: RestakeDgaiEventEntity) {
    await client.query(
      `insert into dgai_staking_restake_dgai_events (
        contract_address, block_number, transaction_hash, log_index, user_address, source_node_id, source_day, target_node_id, target_day, amount, block_timestamp
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      on conflict (transaction_hash, log_index) do update set
        contract_address = excluded.contract_address,
        block_number = excluded.block_number,
        user_address = excluded.user_address,
        source_node_id = excluded.source_node_id,
        source_day = excluded.source_day,
        target_node_id = excluded.target_node_id,
        target_day = excluded.target_day,
        amount = excluded.amount,
        block_timestamp = excluded.block_timestamp`,
      [
        event.contractAddress,
        event.blockNumber,
        event.transactionHash,
        event.logIndex,
        event.user,
        event.sourceNodeId,
        event.sourceDay,
        event.targetNodeId,
        event.targetDay,
        event.amount,
        event.blockTimestamp
      ]
    );
  }

  private async saveHarvest(client: PoolClient, event: HarvestEventEntity) {
    await client.query(
      `insert into dgrid_stake_pool_harvest_events (
        contract_address, block_number, transaction_hash, log_index, user_address, amount, reward_token, block_timestamp
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (transaction_hash, log_index) do update set
        contract_address = excluded.contract_address,
        block_number = excluded.block_number,
        user_address = excluded.user_address,
        amount = excluded.amount,
        reward_token = excluded.reward_token,
        block_timestamp = excluded.block_timestamp`,
      [
        event.contractAddress,
        event.blockNumber,
        event.transactionHash,
        event.logIndex,
        event.user,
        event.amount,
        event.rewardToken,
        event.blockTimestamp
      ]
    );
  }
}
