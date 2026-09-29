import 'dotenv/config';
import { getAddress, type Address } from 'viem';

export type ContractConfig = {
  name: string;
  address: Address;
  abiPath: string;
};

export type AppConfig = {
  rpcUrl: string;
  databaseUrl: string;
  startBlock: bigint;
  endBlock: bigint | 'latest';
  blockStep: bigint;
  rpcTimeoutMs: number;
  retryDelayMs: number;
  contracts: ContractConfig[];
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function parseBlock(value: string): bigint | 'latest' {
  return value === 'latest' ? 'latest' : BigInt(value);
}

export function loadConfig(): AppConfig {
  return {
    rpcUrl: requireEnv('RPC_URL'),
    databaseUrl: requireEnv('DATABASE_URL'),
    startBlock: BigInt(process.env.START_BLOCK ?? '0'),
    endBlock: parseBlock(process.env.END_BLOCK ?? 'latest'),
    blockStep: BigInt(process.env.BLOCK_STEP ?? '2000'),
    rpcTimeoutMs: Number(process.env.RPC_TIMEOUT_MS ?? '30000'),
    retryDelayMs: Number(process.env.RETRY_DELAY_MS ?? '15000'),
    contracts: [
      {
        name: 'DGAIStaking',
        address: getAddress(process.env.DGAI_STAKING_PROXY_ADDRESS ?? '0xA592a0E77d714cEa7d729F020bD9a9107AfE60Bb'),
        abiPath: 'src/abi/DGAIStaking.json'
      },
      {
        name: 'DgridStakePool',
        address: getAddress(process.env.DGRID_STAKE_POOL_PROXY_ADDRESS ?? '0xD94a8b79b0c1731301904B8b696253d0C2b6dce3'),
        abiPath: 'src/abi/DgridStakePool.json'
      }
    ]
  };
}
