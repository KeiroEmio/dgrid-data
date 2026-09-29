import { isAddress } from 'viem';
import type { EventStats, IndexedEvent, JsonValue } from './types.js';

function collectAddresses(value: JsonValue, addresses: Set<string>) {
  if (typeof value === 'string' && isAddress(value)) {
    addresses.add(value.toLowerCase());
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectAddresses(item, addresses);
    return;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAddresses(item, addresses);
  }
}

function getAmount(args: Record<string, JsonValue>) {
  const value = args.amount ?? args.value;
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

export function buildEventStats(events: IndexedEvent[], fromBlock: bigint, toBlock: bigint): EventStats[] {
  const groups = new Map<string, IndexedEvent[]>();

  for (const event of events) {
    const key = `${event.contractName}:${event.eventName}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const addresses = new Set<string>();
    let totalAmount = 0n;

    for (const event of group) {
      collectAddresses(event.args, addresses);
      totalAmount += getAmount(event.args);
    }

    return {
      contractName: group[0].contractName,
      eventName: group[0].eventName,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      totalEvents: group.length,
      uniqueUsers: addresses.size,
      totalAmount: totalAmount.toString()
    };
  });
}
