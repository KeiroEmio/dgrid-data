import 'dotenv/config';
import { createWriteStream } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { Pool, type PoolClient } from 'pg';
import { finished } from 'node:stream/promises';
import { createPublicClient, getAddress, http, type Abi, type Address } from 'viem';
import { loadConfig } from './config/index.js';

const REPORT_LOCK_ID = 2026112401;

function positiveIntegerEnv(name: string, fallback: number, maximum: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

const PAGE_SIZE = positiveIntegerEnv('STAKING_CURRENT_REPORT_PAGE_SIZE', 100, 500);
const CONCURRENCY = positiveIntegerEnv('STAKING_CURRENT_REPORT_CONCURRENCY', 5, 25);
const INDEXER_WAIT_MS = positiveIntegerEnv('STAKING_CURRENT_REPORT_INDEXER_WAIT_MS', 300_000, 3_600_000);
const INDEXER_POLL_MS = positiveIntegerEnv('STAKING_CURRENT_REPORT_INDEXER_POLL_MS', 5_000, 60_000);

type Position = {
  nodeId: bigint;
  tierId: bigint;
  day: bigint;
  fixedRate: bigint;
  nodeStatus: number;
  nodeOwner: Address;
  pendingReward: bigint;
  lastClaimTime: bigint;
  amount: bigint;
  pendingUnstake: bigint;
  unpaid: bigint;
  claimedAmount: bigint;
};

type ReportBlock = {
  number: bigint;
  timestamp: bigint;
  hash: `0x${string}`;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForIndexer(pool: Pool, blockNumber: bigint) {
  const deadline = Date.now() + INDEXER_WAIT_MS;
  while (true) {
    const result = await pool.query<{ next_from_block: string }>(
      `select next_from_block::text from block_indexer where indexer_name = 'DGridContracts'`
    );
    const nextFromBlock = result.rows[0]?.next_from_block;
    if (nextFromBlock !== undefined && BigInt(nextFromBlock) > blockNumber) return;

    if (Date.now() >= deadline) {
      throw new Error(
        `Crawler has not indexed through report block ${blockNumber} (next_from_block=${nextFromBlock ?? 'missing'}). ` +
        'Wait for the crawler to catch up, then rerun this one-time report.'
      );
    }

    console.log(
      `Waiting for crawler to pass report block ${blockNumber}; next_from_block=${nextFromBlock ?? 'missing'}`
    );
    await sleep(INDEXER_POLL_MS);
  }
}

function csvCell(value: string | number | bigint) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeCsvRow(
  stream: ReturnType<typeof createWriteStream>,
  values: Array<string | number | bigint>
) {
  if (!stream.write(`${values.map(csvCell).join(',')}\n`)) await once(stream, 'drain');
}

async function stagePositionPage(
  client: PoolClient,
  rows: Array<{ wallet: string; positions: Position[] }>
) {
  const positions = rows.flatMap(({ wallet, positions: userPositions }) =>
    userPositions.map((position) => ({ wallet, position }))
  );
  if (positions.length === 0) return 0;

  const arrays = [
    positions.map(({ wallet }) => wallet),
    positions.map(({ position }) => position.nodeId.toString()),
    positions.map(({ position }) => position.tierId.toString()),
    positions.map(({ position }) => position.day.toString()),
    positions.map(({ position }) => position.fixedRate.toString()),
    positions.map(({ position }) => String(position.nodeStatus)),
    positions.map(({ position }) => position.nodeOwner.toLowerCase()),
    positions.map(({ position }) => position.amount.toString()),
    positions.map(({ position }) => position.pendingUnstake.toString()),
    positions.map(({ position }) => (position.amount + position.pendingUnstake).toString()),
    positions.map(({ position }) => position.pendingReward.toString()),
    positions.map(({ position }) => position.unpaid.toString()),
    positions.map(({ position }) => position.claimedAmount.toString()),
    positions.map(({ position }) => position.lastClaimTime.toString())
  ];
  const types = [
    'text[]', 'numeric[]', 'numeric[]', 'numeric[]', 'numeric[]', 'smallint[]', 'text[]',
    'numeric[]', 'numeric[]', 'numeric[]', 'numeric[]', 'numeric[]', 'numeric[]', 'numeric[]'
  ];
  const columns = [
    'wallet', 'node_id', 'tier_id', 'day', 'fixed_rate', 'node_status', 'node_owner',
    'amount_raw', 'pending_unstake_raw', 'principal_raw', 'pending_reward_raw', 'unpaid_raw',
    'claimed_amount_raw', 'last_claim_time'
  ];
  const args = arrays.map((_, index) => `$${index + 1}::${types[index]}`).join(', ');

  await client.query(
    `insert into pg_temp.staking_current_report_positions (${columns.join(', ')})
     select ${columns.map((column) => `items.${column}`).join(', ')}
     from unnest(${args}) as items(${columns.join(', ')})`,
    arrays
  );
  return positions.length;
}

async function main() {
  const config = loadConfig();
  const stakingContract = config.contracts.find((contract) => contract.name === 'DGAIStaking');
  if (!stakingContract) throw new Error('DGAIStaking contract configuration is missing');

  const { abi } = JSON.parse(
    await readFile(join(process.cwd(), stakingContract.abiPath), 'utf8')
  ) as { abi: Abi };
  const chain = createPublicClient({ transport: http(config.rpcUrl, { timeout: config.rpcTimeoutMs }) });
  const pool = new Pool({ connectionString: config.databaseUrl });
  const lockClient = await pool.connect();
  let hasLock = false;
  let tempFilePath: string | undefined;
  let stream: ReturnType<typeof createWriteStream> | undefined;
  let streamFinished: Promise<void> | undefined;

  try {
    const lockResult = await lockClient.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1) as locked', [REPORT_LOCK_ID]
    );
    hasLock = lockResult.rows[0]?.locked ?? false;
    if (!hasLock) throw new Error('Another staking current-report job is already running.');

    const [chainId, number] = await Promise.all([chain.getChainId(), chain.getBlockNumber()]);
    const block = await chain.getBlock({ blockNumber: number });
    const reportBlock: ReportBlock = {
      number,
      timestamp: block.timestamp,
      hash: block.hash!
    };
    await waitForIndexer(pool, reportBlock.number);
    await lockClient.query(`
      create temporary table staking_current_report_positions (
        wallet text not null,
        node_id numeric not null,
        tier_id numeric not null,
        day numeric not null,
        fixed_rate numeric not null,
        node_status smallint not null,
        node_owner text not null,
        amount_raw numeric not null,
        pending_unstake_raw numeric not null,
        principal_raw numeric not null,
        pending_reward_raw numeric not null,
        unpaid_raw numeric not null,
        claimed_amount_raw numeric not null,
        last_claim_time numeric not null,
        wallet_total_amount_raw numeric not null default 0,
        primary key (wallet, node_id, tier_id)
      ) on commit preserve rows
    `);
    const walletsResult = await pool.query<{ wallet: string }>(
      `select wallet from (
         select lower(staker) as wallet
         from dgai_staking_stake_events
         where block_number <= $1::numeric
         union
         select lower(staker) as wallet
         from dgai_staking_unstake_events
         where block_number <= $1::numeric
         union
         select lower(staker) as wallet
         from dgai_staking_claim_events
         where block_number <= $1::numeric
         union
         select lower(staker) as wallet
         from dgai_staking_claim_unstake_events
         where block_number <= $1::numeric
         union
         select lower(staker) as wallet
         from dgai_staking_cancel_unstake_events
         where block_number <= $1::numeric
         union
         select lower(user_address) as wallet
         from dgai_staking_change_node_events
         where block_number <= $1::numeric
         union
         select lower(user_address) as wallet
         from dgai_staking_restake_reward_call_events
         where block_number <= $1::numeric
         union
         select lower(user_address) as wallet
         from dgai_staking_restake_dgai_events
         where block_number <= $1::numeric
       ) staking_wallets
       where wallet is not null
       order by wallet`,
      [reportBlock.number.toString()]
    );
    const wallets = walletsResult.rows.map(({ wallet }) => wallet);

    console.log(
      `Collecting ${wallets.length} staking wallets at block ${reportBlock.number} ` +
      `(${reportBlock.hash}, chain ${chainId})`
    );

    let processedWallets = 0;
    let positionCount = 0;
    for (let offset = 0; offset < wallets.length; offset += PAGE_SIZE) {
      const page = wallets.slice(offset, offset + PAGE_SIZE);
      const userPositions = await mapLimit(page, CONCURRENCY, async (wallet) => {
        const positions = await chain.readContract({
          address: stakingContract.address,
          abi,
          functionName: 'getPositions',
          args: [getAddress(wallet)],
          blockNumber: reportBlock.number
        }) as Position[];
        return { wallet, positions };
      });

      const insertedPositions = await stagePositionPage(lockClient, userPositions);
      processedWallets += page.length;
      positionCount += insertedPositions;
      console.log(`Processed ${processedWallets}/${wallets.length} wallets; stored ${positionCount} positions`);
    }

    await lockClient.query(`
      update pg_temp.staking_current_report_positions positions
      set wallet_total_amount_raw = totals.total_amount
      from (
        select wallet, sum(amount_raw) as total_amount
        from pg_temp.staking_current_report_positions
        group by wallet
      ) totals
      where positions.wallet = totals.wallet;

      create temporary table staking_current_report_export on commit preserve rows as
      select row_number() over (
        order by wallet_total_amount_raw desc, wallet asc, node_id asc, tier_id asc
      ) as export_row, *
      from pg_temp.staking_current_report_positions;

      create unique index staking_current_report_export_row_idx
        on pg_temp.staking_current_report_export (export_row);
    `);

    const outputDirectory = process.env.STAKING_CURRENT_REPORT_OUTPUT_DIR ?? '/output';
    const outputName = `staking-current-report-${reportBlock.number}-${Date.now()}.csv`;
    const outputPath = join(outputDirectory, outputName);
    tempFilePath = `${outputPath}.tmp`;
    stream = createWriteStream(tempFilePath, { flags: 'wx' });
    streamFinished = finished(stream);
    void streamFinished.catch(() => undefined);
    await writeCsvRow(stream, [
      'chain_id', 'block_number', 'block_timestamp', 'block_hash', 'wallet', 'wallet_total_amount_raw',
      'node_id', 'tier_id', 'day', 'fixed_rate', 'node_status', 'node_owner', 'amount_raw',
      'pending_unstake_raw', 'principal_raw', 'pending_reward_raw', 'unpaid_raw',
      'claimed_amount_raw', 'last_claim_time'
    ]);

    let lastExportRow = 0;
    while (true) {
      const exportPage = await lockClient.query<{
        export_row: string;
        wallet: string;
        wallet_total_amount_raw: string;
        node_id: string;
        tier_id: string;
        day: string;
        fixed_rate: string;
        node_status: number;
        node_owner: string;
        amount_raw: string;
        pending_unstake_raw: string;
        principal_raw: string;
        pending_reward_raw: string;
        unpaid_raw: string;
        claimed_amount_raw: string;
        last_claim_time: string;
      }>(
        `select export_row::text, wallet, wallet_total_amount_raw::text, node_id::text, tier_id::text,
                day::text, fixed_rate::text, node_status, node_owner, amount_raw::text,
                pending_unstake_raw::text, principal_raw::text, pending_reward_raw::text,
                unpaid_raw::text, claimed_amount_raw::text, last_claim_time::text
         from pg_temp.staking_current_report_export
         where export_row > $1
         order by export_row
         limit $2`,
        [lastExportRow, PAGE_SIZE]
      );
      if (exportPage.rows.length === 0) break;

      for (const row of exportPage.rows) {
        await writeCsvRow(stream, [
          chainId, reportBlock.number, reportBlock.timestamp, reportBlock.hash,
          row.wallet, row.wallet_total_amount_raw, row.node_id, row.tier_id, row.day,
          row.fixed_rate, row.node_status, row.node_owner, row.amount_raw,
          row.pending_unstake_raw, row.principal_raw, row.pending_reward_raw,
          row.unpaid_raw, row.claimed_amount_raw, row.last_claim_time
        ]);
        lastExportRow = Number(row.export_row);
      }
      console.log(`Exported ${lastExportRow}/${positionCount} positions, sorted by wallet total stake descending`);
    }

    stream.end();
    await streamFinished;
    await rename(tempFilePath, outputPath);
    tempFilePath = undefined;
    console.log(
      `Report completed: ${processedWallets} wallets, ${positionCount} positions at block ${reportBlock.number}`
    );
    console.log(`CSV file: ${outputPath}`);
  } catch (error) {
    if (stream && !stream.destroyed) {
      stream.destroy();
    }
    if (streamFinished) await streamFinished.catch(() => undefined);
    throw error;
  } finally {
    if (tempFilePath) await rm(tempFilePath, { force: true }).catch(() => undefined);
    if (hasLock) await lockClient.query('select pg_advisory_unlock($1)', [REPORT_LOCK_ID]);
    lockClient.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Staking current report failed:', error);
  process.exitCode = 1;
});
