import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPublicClient, decodeFunctionData, http, parseEventLogs, type Abi, type Hex } from 'viem';
import { loadConfig, type ContractConfig } from './config/index.js';
import { DGAI_STAKING_EVENT_NAMES, DGRID_STAKE_POOL_EVENT_NAMES, toDgaiStakingEventEntity } from './entities/index.js';
import { Database } from './persistence/index.js';
import type { IndexedEvent, JsonValue } from './types.js';

const rootDir = process.cwd();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AbiFile = {
  abi: Abi;
};

function toJsonValue(value: unknown): JsonValue {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return String(value);
}

async function loadAbi(contract: ContractConfig) {
  const raw = await readFile(join(rootDir, contract.abiPath), 'utf8');
  const parsed = JSON.parse(raw) as AbiFile;
  return parsed.abi;
}

function getEventNames(contractName: string) {
  return contractName === 'DgridStakePool' ? DGRID_STAKE_POOL_EVENT_NAMES : DGAI_STAKING_EVENT_NAMES;
}

async function fetchContractEvents(
  client: ReturnType<typeof createPublicClient>,
  contract: ContractConfig,
  fromBlock: bigint,
  toBlock: bigint
): Promise<IndexedEvent[]> {
  const abi = await loadAbi(contract);
  const logs = await client.getLogs({
    address: contract.address,
    fromBlock,
    toBlock
  });

  const decodedLogs = parseEventLogs({ abi, logs, strict: false });
  const eventNames = getEventNames(contract.name);
  const filteredLogs = decodedLogs.filter((log) => eventNames.includes(log.eventName as never));
  const stakeTransactionHashes = [
    ...new Set(filteredLogs.filter((log) => log.eventName === 'Stake').map((log) => log.transactionHash))
  ];
  const transactionFunctionNames = await getTransactionFunctionNames(client, abi, stakeTransactionHashes);

  return filteredLogs.map((log) => ({
    contractName: contract.name,
    contractAddress: contract.address,
    eventName: log.eventName,
    blockNumber: log.blockNumber.toString(),
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
    transactionFunctionName: transactionFunctionNames.get(log.transactionHash),
    args: toJsonValue(log.args ?? {}) as Record<string, JsonValue>
  }));
}

async function getBlockTimestamps(
  client: ReturnType<typeof createPublicClient>,
  events: IndexedEvent[]
) {
  if (events.length === 0) return new Map<string, bigint>();

  const blockNumbers = [...new Set(events.map((event) => event.blockNumber))];
  const entries = await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
      return [blockNumber, block.timestamp] as const;
    })
  );

  return new Map(entries);
}

async function getTransactionFunctionNames(
  client: ReturnType<typeof createPublicClient>,
  abi: Abi,
  transactionHashes: Hex[]
) {
  const entries: Array<readonly [Hex, string | undefined]> = [];
  const batchSize = 25;

  for (let index = 0; index < transactionHashes.length; index += batchSize) {
    const batch = transactionHashes.slice(index, index + batchSize);
    const batchEntries = await Promise.all(
      batch.map(async (transactionHash) => {
        const transaction = await client.getTransaction({ hash: transactionHash });
        try {
          const decoded = decodeFunctionData({ abi, data: transaction.input });
          return [transactionHash, decoded.functionName] as const;
        } catch {
          return [transactionHash, undefined] as const;
        }
      })
    );

    entries.push(...batchEntries);
  }

  return new Map(entries.filter((entry): entry is readonly [Hex, string] => entry[1] !== undefined));
}

async function main() {
  const config = loadConfig();
  const client = createPublicClient({ transport: http(config.rpcUrl, { timeout: config.rpcTimeoutMs }) });
  const database = new Database(config.databaseUrl);
  const indexerName = 'DGridContracts';

  await database.migrate();

  try {
    let fromBlock = await database.getNextFromBlock(indexerName, config.startBlock);

    while (true) {
      const latestBlock = await client.getBlockNumber();
      const endBlock = config.endBlock === 'latest' ? latestBlock : config.endBlock;

      if (fromBlock > endBlock) {
        if (config.endBlock !== 'latest') break;
        console.log(`Waiting for new blocks after ${endBlock}`);
        await sleep(config.retryDelayMs);
        continue;
      }

      const toBlock = fromBlock + config.blockStep > endBlock ? endBlock : fromBlock + config.blockStep;

      try {
        console.log(`Fetching ${config.contracts.length} contracts: ${fromBlock}-${toBlock}`);
        const contractEvents = await Promise.all(
          config.contracts.map(async (contract) => {
            console.log(`Fetching ${contract.name}: ${fromBlock}-${toBlock}`);
            return fetchContractEvents(client, contract, fromBlock, toBlock);
          })
        );
        const events = contractEvents.flat();
        const entities = events.map(toDgaiStakingEventEntity).filter((event) => event !== null);
        const blockTimestamps = await getBlockTimestamps(client, events);

        // for (const event of entities) {
        //   console.log(JSON.stringify(event, null, 2));
        // }

        await database.saveEvents(events);
        await database.dgaiStakingEvents.saveMany(entities);
        await database.updateFixedRateRewardState(entities, blockTimestamps);
        fromBlock = toBlock + 1n;
        await database.markCrawlerSuccess(indexerName, fromBlock);

        console.log(`Saved ${entities.length} events for block range ending ${toBlock}`);
      } catch (error) {
        console.error(`Fetch failed: ${fromBlock}-${toBlock}`);
        console.error(error);
        await database.markCrawlerFailure(indexerName, fromBlock, toBlock, error);
        console.log(`Retrying ${fromBlock}-${toBlock} after ${config.retryDelayMs}ms`);
        await sleep(config.retryDelayMs);
      }
    }
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
