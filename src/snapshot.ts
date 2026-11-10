import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createPublicClient, getAddress, http, type Abi, type Address } from 'viem';
import { loadConfig } from './config/index.js';
import { migrateStakingSnapshotSchema } from './persistence/staking-snapshot-schema.js';

function positiveIntegerEnv(name: string, fallback: number, minimum = 1) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

const PAGE_SIZE = positiveIntegerEnv('STAKING_SNAPSHOT_PAGE_SIZE', 100);
const CONCURRENCY = positiveIntegerEnv('STAKING_SNAPSHOT_CONCURRENCY', 5);
const RETRY_DELAY_MS = positiveIntegerEnv('STAKING_SNAPSHOT_RETRY_DELAY_MS', 60_000, 1_000);

type Position = {
  nodeId: bigint;
  day: bigint;
  nodeStatus: number;
  nodeOwner: Address;
  pendingReward: bigint;
  lastClaimTime: bigint;
  amount: bigint;
  pendingUnstake: bigint;
  unpaid: bigint;
  claimedAmount: bigint;
};

type Snapshot = {
  snapshot_date: string;
  block_number: string;
  block_timestamp: string;
  block_hash: string;
  status: string;
  total_wallets: string;
  processed_wallets: string;
  stored_wallets: string;
  last_wallet: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function utcDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function millisecondsUntilNextUtcDay(date = new Date()) {
  const nextUtcDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1_000, nextUtcDay - date.getTime());
}

async function findSnapshotBlock(client: ReturnType<typeof createPublicClient>, targetTimestamp: bigint) {
  let low = 0n;
  let high = await client.getBlockNumber();
  const genesis = await client.getBlock({ blockNumber: 0n });
  if (genesis.timestamp > targetTimestamp) throw new Error(`No block exists at target timestamp ${targetTimestamp}`);

  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    const block = await client.getBlock({ blockNumber: middle });
    if (block.timestamp <= targetTimestamp) low = middle;
    else high = middle - 1n;
  }

  const block = await client.getBlock({ blockNumber: low });
  return { number: block.number!, timestamp: block.timestamp, hash: block.hash! };
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

async function main() {
  const config = loadConfig();
  const stakingContract = config.contracts.find((contract) => contract.name === 'DGAIStaking');
  if (!stakingContract) throw new Error('DGAIStaking contract configuration is missing');
  const abiPath = join(process.cwd(), stakingContract.abiPath);
  const parsed = JSON.parse(await readFile(abiPath, 'utf8')) as { abi: Abi };
  const abi = parsed.abi;
  const client = createPublicClient({ transport: http(config.rpcUrl, { timeout: config.rpcTimeoutMs }) });
  const pool = new Pool({ connectionString: config.databaseUrl });

  const lockClient = await pool.connect();
  let hasLock = false;
  try {
    const lockResult = await lockClient.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1) as locked',
      [2026110901]
    );
    hasLock = lockResult.rows[0].locked;
    if (!hasLock) {
      console.log('Another staking snapshot worker already holds the lock');
      return;
    }

    await migrateStakingSnapshotSchema(pool);
    while (true) {
      const today = utcDate();
      const pendingResult = await pool.query<{ snapshot_date: string }>(
        `select snapshot_date::text from staking_position_snapshots
         where status <> 'completed' and snapshot_date <= $1::date
         order by snapshot_date asc limit 1`,
        [today]
      );
      const date = pendingResult.rows[0]?.snapshot_date ?? today;
      try {
        const completed = await runSnapshot(pool, client, stakingContract.address, abi, date);
        if (completed && date === utcDate()) {
          const waitMs = millisecondsUntilNextUtcDay();
          console.log(`Snapshot ${date} is complete; next run starts at UTC 00:00 in ${waitMs}ms`);
          await sleep(waitMs);
        } else if (!completed) {
          await sleep(RETRY_DELAY_MS);
        }
      } catch (error) {
        await pool.query(
          `update staking_position_snapshots set status = 'failed', error = $2 where snapshot_date = $1 and status <> 'completed'`,
          [date, error instanceof Error ? error.message : String(error)]
        );
        console.error(`Snapshot ${date} failed; retrying in ${RETRY_DELAY_MS}ms`, error);
        await sleep(RETRY_DELAY_MS);
      }
    }
  } finally {
    if (hasLock) await lockClient.query('select pg_advisory_unlock($1)', [2026110901]);
    lockClient.release();
    await pool.end();
  }
}

async function runSnapshot(
  pool: Pool,
  client: ReturnType<typeof createPublicClient>,
  contractAddress: Address,
  abi: Abi,
  date: string
) {
  let result = await pool.query<Snapshot>(
    'select snapshot_date::text, block_number::text, block_timestamp::text, block_hash, status, total_wallets::text, processed_wallets::text, stored_wallets::text, last_wallet from staking_position_snapshots where snapshot_date = $1',
    [date]
  );
  let snapshot = result.rows[0];
  if (snapshot?.status === 'completed') return true;

  if (!snapshot) {
    const targetTimestamp = BigInt(Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000));
    const block = await findSnapshotBlock(client, targetTimestamp);
    const inserted = await pool.query<Snapshot>(
      `insert into staking_position_snapshots (snapshot_date, block_number, block_timestamp, block_hash, status)
       values ($1, $2, $3, $4, 'pending') on conflict (snapshot_date) do nothing
       returning snapshot_date::text, block_number::text, block_timestamp::text, block_hash, status, total_wallets::text, processed_wallets::text, stored_wallets::text, last_wallet`,
      [date, block.number.toString(), block.timestamp.toString(), block.hash]
    );
    result = inserted.rowCount ? inserted : await pool.query<Snapshot>(
      'select snapshot_date::text, block_number::text, block_timestamp::text, block_hash, status, total_wallets::text, processed_wallets::text, stored_wallets::text, last_wallet from staking_position_snapshots where snapshot_date = $1',
      [date]
    );
    snapshot = result.rows[0];
  }

  const snapshotBlock = BigInt(snapshot.block_number);
  const cursorResult = await pool.query<{ next_from_block: string }>(
    `select next_from_block::text from block_indexer where indexer_name = 'DGridContracts'`
  );
  if (cursorResult.rowCount === 0 || BigInt(cursorResult.rows[0].next_from_block) <= snapshotBlock) {
    console.log(`Snapshot ${date} waits for crawler to pass block ${snapshotBlock}`);
    return false;
  }

  if (snapshot.status === 'completed') return true;
  await pool.query(
    `update staking_position_snapshots set status = 'running', error = null, started_at = coalesce(started_at, now()) where snapshot_date = $1`,
    [date]
  );

  const walletsResult = await pool.query<{ wallet: string }>(
    `select wallet from (
       select lower(staker) as wallet
       from dgai_staking_stake_events
       where block_number <= $1::numeric and node_id in (2, 3)
       union
       select lower(user_address) as wallet
       from dgai_staking_change_node_events
       where block_number <= $1::numeric and to_node_id in (2, 3)
     ) target_node_candidates
     order by wallet`,
    [snapshotBlock.toString()]
  );
  const wallets = walletsResult.rows.map(({ wallet }) => wallet);
  await pool.query(
    `update staking_position_snapshots set total_wallets = $2 where snapshot_date = $1`,
    [date, wallets.length]
  );
  const remaining = wallets.filter((wallet) => snapshot.last_wallet === null || wallet > snapshot.last_wallet);
  let processed = BigInt(snapshot.processed_wallets);
  let stored = BigInt(snapshot.stored_wallets);

  for (let index = 0; index < remaining.length; index += PAGE_SIZE) {
    const page = remaining.slice(index, index + PAGE_SIZE);
    const rows = await mapLimit(page, CONCURRENCY, async (wallet) => {
      const positions = await client.readContract({
        address: contractAddress,
        abi,
        functionName: 'getPositions',
        args: [getAddress(wallet)],
        blockNumber: snapshotBlock
      }) as Position[];
      return { wallet, positions: positions.filter((position) => position.nodeId === 2n || position.nodeId === 3n) };
    });

    const dbClient = await pool.connect();
    try {
      await dbClient.query('begin');
      let storedInPage = 0;
      for (const item of rows) {
        if (item.positions.length === 0) continue;
        storedInPage++;
        for (const position of item.positions) {
          await dbClient.query(
            `insert into staking_position_snapshot_positions (
              snapshot_date, wallet, node_id, day, node_status, node_owner, pending_reward,
              last_claim_time, amount, pending_unstake, unpaid, claimed_amount
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            on conflict (snapshot_date, wallet, node_id, day) do update set
              node_status = excluded.node_status, node_owner = excluded.node_owner,
              pending_reward = excluded.pending_reward, last_claim_time = excluded.last_claim_time,
              amount = excluded.amount, pending_unstake = excluded.pending_unstake,
              unpaid = excluded.unpaid, claimed_amount = excluded.claimed_amount`,
            [date, item.wallet, position.nodeId.toString(), position.day.toString(), position.nodeStatus,
              position.nodeOwner.toLowerCase(), position.pendingReward.toString(), position.lastClaimTime.toString(),
              position.amount.toString(), position.pendingUnstake.toString(), position.unpaid.toString(), position.claimedAmount.toString()]
          );
        }
      }
      processed += BigInt(page.length);
      stored += BigInt(storedInPage);
      await dbClient.query(
        `update staking_position_snapshots set processed_wallets = $2, stored_wallets = $3, last_wallet = $4 where snapshot_date = $1`,
        [date, processed.toString(), stored.toString(), page[page.length - 1]]
      );
      await dbClient.query('commit');
    } catch (error) {
      await dbClient.query('rollback');
      throw error;
    } finally {
      dbClient.release();
    }
    console.log(`Snapshot ${date}: processed ${processed}/${wallets.length} wallets`);
  }

  await pool.query(
    `update staking_position_snapshots set status = 'completed', error = null, completed_at = now(), processed_wallets = total_wallets where snapshot_date = $1`,
    [date]
  );
  console.log(`Snapshot ${date} completed at block ${snapshotBlock}`);
  return true;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
