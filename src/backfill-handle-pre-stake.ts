import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createPublicClient, decodeFunctionData, http, type Abi, type Hex } from 'viem';
import { loadConfig } from './config/index.js';

type AbiFile = {
  abi: Abi;
};

const rootDir = process.cwd();
const batchSize = Number(process.env.BACKFILL_HANDLE_PRE_STAKE_BATCH_SIZE ?? '25');

async function loadDgaiStakingAbi() {
  const raw = await readFile(join(rootDir, 'src/abi/DGAIStaking.json'), 'utf8');
  const parsed = JSON.parse(raw) as AbiFile;
  return parsed.abi;
}

async function main() {
  const config = loadConfig();
  const abi = await loadDgaiStakingAbi();
  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = createPublicClient({ transport: http(config.rpcUrl) });

  try {
    const result = await pool.query<{ transaction_hash: Hex }>(
      `select distinct transaction_hash
      from dgai_staking_stake_events
      where is_handle_pre_stake = false
      order by transaction_hash`
    );

    let processed = 0;
    let matched = 0;
    let failed = 0;

    for (let index = 0; index < result.rows.length; index += batchSize) {
      const batch = result.rows.slice(index, index + batchSize);
      const hashes = await Promise.all(
        batch.map(async ({ transaction_hash }) => {
          try {
            const transaction = await client.getTransaction({ hash: transaction_hash });
            const decoded = decodeFunctionData({ abi, data: transaction.input });
            return decoded.functionName === 'handlePreStake' ? transaction_hash : null;
          } catch (error) {
            failed += 1;
            console.error(`failed to decode ${transaction_hash}`, error);
            return null;
          } finally {
            processed += 1;
          }
        })
      );

      const handlePreStakeHashes = hashes.filter((hash): hash is Hex => hash !== null);
      if (handlePreStakeHashes.length > 0) {
        await pool.query(
          `update dgai_staking_stake_events
          set is_handle_pre_stake = true
          where is_handle_pre_stake = false
            and transaction_hash = any($1::text[])`,
          [handlePreStakeHashes]
        );
        matched += handlePreStakeHashes.length;
      }

      console.log(`processed ${processed}/${result.rows.length}, matched ${matched}, failed ${failed}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
