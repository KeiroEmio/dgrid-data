import type { Address, Hex } from 'viem';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type IndexedEvent = {
  contractName: string;
  contractAddress: Address;
  eventName: string;
  blockNumber: string;
  transactionHash: Hex;
  logIndex: number;
  transactionFunctionName?: string;
  args: Record<string, JsonValue>;
};

export type EventStats = {
  contractName: string;
  eventName: string;
  fromBlock: string;
  toBlock: string;
  totalEvents: number;
  uniqueUsers: number;
  totalAmount: string;
};
