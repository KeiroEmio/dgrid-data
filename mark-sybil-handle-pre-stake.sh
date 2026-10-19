#!/usr/bin/env bash
set -euo pipefail

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required"
  exit 1
fi

psql "$DATABASE_URL" <<'SQL'
begin;

create table if not exists dgai_staking_sybil_wallets (
  wallet text primary key,
  reason text not null,
  min_stake_raw numeric not null,
  first_block_number numeric not null,
  first_transaction_hash text not null,
  first_log_index integer not null,
  detected_at timestamptz not null default now()
);

create temporary table tmp_handle_pre_stake_sybil_wallets on commit drop as
select distinct on (lower(staker))
  lower(staker) as wallet,
  'handlePreStake stake amount < 3e18' as reason,
  amount as min_stake_raw,
  block_number as first_block_number,
  transaction_hash as first_transaction_hash,
  log_index as first_log_index
from dgai_staking_stake_events
where is_handle_pre_stake = true
  and amount < 3000000000000000000
order by lower(staker), amount asc, block_number asc, log_index asc;

insert into dgai_staking_sybil_wallets (
  wallet,
  reason,
  min_stake_raw,
  first_block_number,
  first_transaction_hash,
  first_log_index
)
select
  wallet,
  reason,
  min_stake_raw,
  first_block_number,
  first_transaction_hash,
  first_log_index
from tmp_handle_pre_stake_sybil_wallets
on conflict (wallet) do update set
  reason = excluded.reason,
  min_stake_raw = excluded.min_stake_raw,
  first_block_number = excluded.first_block_number,
  first_transaction_hash = excluded.first_transaction_hash,
  first_log_index = excluded.first_log_index,
  detected_at = now();

delete from dgai_staking_sybil_wallets sybil
where sybil.reason = 'handlePreStake stake amount < 3e18'
  and not exists (
    select 1
    from tmp_handle_pre_stake_sybil_wallets tmp
    where tmp.wallet = sybil.wallet
  );

select count(*) as sybil_wallet_count
from dgai_staking_sybil_wallets
where reason = 'handlePreStake stake amount < 3e18';

commit;
SQL
