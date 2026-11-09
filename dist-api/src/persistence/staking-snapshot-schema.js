export async function migrateStakingSnapshotSchema(database) {
    await database.query(`
    begin;
    select pg_advisory_xact_lock(2026110902);

    create table if not exists staking_position_snapshots (
      snapshot_date date primary key,
      block_number numeric not null,
      block_timestamp numeric not null,
      block_hash text not null,
      status text not null check (status in ('pending', 'running', 'completed', 'failed')),
      total_wallets bigint not null default 0,
      processed_wallets bigint not null default 0,
      stored_wallets bigint not null default 0,
      last_wallet text,
      error text,
      started_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz not null default now()
    );

    create table if not exists staking_position_snapshot_positions (
      snapshot_date date not null references staking_position_snapshots(snapshot_date) on delete cascade,
      wallet text not null,
      node_id numeric not null,
      day numeric not null,
      node_status smallint not null,
      node_owner text not null,
      pending_reward numeric not null,
      last_claim_time numeric not null,
      amount numeric not null,
      pending_unstake numeric not null,
      unpaid numeric not null,
      claimed_amount numeric not null,
      primary key (snapshot_date, wallet, node_id, day)
    );

    commit;
  `);
}
