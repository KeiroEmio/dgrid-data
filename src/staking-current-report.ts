import 'dotenv/config';
import { createWriteStream } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { Pool } from 'pg';
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

async function writePositionPage(
  stream: ReturnType<typeof createWriteStream>,
  reportBlock: ReportBlock & { chainId: number },
  rows: Array<{ wallet: string; positions: Position[] }>
) {
  const positions = rows.flatMap(({ wallet, positions: userPositions }) =>
    userPositions.map((position) => ({ wallet, position }))
  );
  for (const { wallet, position } of positions) {
    await writeCsvRow(stream, [
      reportBlock.chainId,
      reportBlock.number,
      reportBlock.timestamp,
      reportBlock.hash,
      wallet,
      position.nodeId,
      position.tierId,
      position.day,
      position.fixedRate,
      position.nodeStatus,
      position.nodeOwner.toLowerCase(),
      position.amount,
      position.pendingUnstake,
      position.amount + position.pendingUnstake,
      position.pendingReward,
      position.unpaid,
      position.claimedAmount,
      position.lastClaimTime
    ]);
  }
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

    const outputDirectory = process.env.STAKING_CURRENT_REPORT_OUTPUT_DIR ?? '/output';
    const outputName = `staking-current-report-${reportBlock.number}-${Date.now()}.csv`;
    const outputPath = join(outputDirectory, outputName);
    tempFilePath = `${outputPath}.tmp`;
    stream = createWriteStream(tempFilePath, { flags: 'wx' });
    const streamFinished = finished(stream);
    void streamFinished.catch(() => undefined);
    await writeCsvRow(stream, [
      'chain_id', 'block_number', 'block_timestamp', 'block_hash', 'wallet', 'node_id',
      'tier_id', 'day', 'fixed_rate', 'node_status', 'node_owner', 'amount_raw',
      'pending_unstake_raw', 'principal_raw', 'pending_reward_raw', 'unpaid_raw',
      'claimed_amount_raw', 'last_claim_time'
    ]);

    console.log(
      `Collecting ${wallets.length} staking wallets at block ${reportBlock.number} ` +
      `(${reportBlock.hash}, chain ${chainId}) into ${outputPath}`
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

      const insertedPositions = await writePositionPage(stream, { ...reportBlock, chainId }, userPositions);
      processedWallets += page.length;
      positionCount += insertedPositions;
      console.log(`Processed ${processedWallets}/${wallets.length} wallets; stored ${positionCount} positions`);
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
