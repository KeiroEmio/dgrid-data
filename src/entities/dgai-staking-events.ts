import { getAddress, type Address, type Hex } from 'viem';
import type { IndexedEvent, JsonValue } from '../types.js';

export const DGAI_STAKING_EVENT_NAMES = [
  'Stake',
  'Unstake',
  'Claim',
  'ClaimUnstake',
  'CancelUnstake',
  'ChangeNode',
  'RestakeRewardCall',
  'RestakeDGAI'
] as const;

export const DGRID_STAKE_POOL_EVENT_NAMES = ['Harvest'] as const;

export type DgaiStakingEventName = (typeof DGAI_STAKING_EVENT_NAMES)[number];
export type DgridStakePoolEventName = (typeof DGRID_STAKE_POOL_EVENT_NAMES)[number];

export type ChainEventMeta = {
  contractAddress: Address;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: Hex;
  logIndex: number;
};

export type StakeEventEntity = ChainEventMeta & {
  eventName: 'Stake';
  nodeId: string;
  staker: Address;
  day: string;
  amount: string;
  isHandlePreStake: boolean;
};

export type UnstakeEventEntity = ChainEventMeta & {
  eventName: 'Unstake';
  nodeId: string;
  staker: Address;
  requestId: string;
  day: string;
  amount: string;
  releaseTime: string;
};

export type ClaimEventEntity = ChainEventMeta & {
  eventName: 'Claim';
  nodeId: string;
  staker: Address;
  day: string;
  amount: string;
};

export type ClaimUnstakeEventEntity = ChainEventMeta & {
  eventName: 'ClaimUnstake';
  staker: Address;
  requestId: string;
  amount: string;
};

export type CancelUnstakeEventEntity = ChainEventMeta & {
  eventName: 'CancelUnstake';
  nodeId: string;
  staker: Address;
  cancelRequestId: string;
  day: string;
  amount: string;
};

export type ChangeNodeEventEntity = ChainEventMeta & {
  eventName: 'ChangeNode';
  user: Address;
  fromNodeId: string;
  toNodeId: string;
  day: string;
  amount: string;
  canceledPendingUnstake: string;
  cancelRequestIds: string[];
};

export type RestakeRewardCallEventEntity = ChainEventMeta & {
  eventName: 'RestakeRewardCall';
  user: Address;
  selectNodeId: string;
  day: string;
  amount: string;
};

export type RestakeDgaiEventEntity = ChainEventMeta & {
  eventName: 'RestakeDGAI';
  user: Address;
  sourceNodeId: string;
  sourceDay: string;
  targetNodeId: string;
  targetDay: string;
  amount: string;
};

export type HarvestEventEntity = ChainEventMeta & {
  eventName: 'Harvest';
  user: Address;
  amount: string;
  rewardToken: Address;
};

export type DgaiStakingEventEntity =
  | StakeEventEntity
  | UnstakeEventEntity
  | ClaimEventEntity
  | ClaimUnstakeEventEntity
  | CancelUnstakeEventEntity
  | ChangeNodeEventEntity
  | RestakeRewardCallEventEntity
  | RestakeDgaiEventEntity
  | HarvestEventEntity;

function asString(value: JsonValue | undefined) {
  if (value === undefined || value === null) throw new Error('Missing event argument');
  return String(value);
}

function asAddress(value: JsonValue | undefined) {
  return getAddress(asString(value));
}

function asStringArray(value: JsonValue | undefined) {
  if (!Array.isArray(value)) throw new Error('Missing event argument');
  return value.map((item) => String(item));
}

function base(event: IndexedEvent): ChainEventMeta {
  if (event.blockTimestamp === undefined) throw new Error('Missing block timestamp');

  return {
    contractAddress: event.contractAddress,
    blockNumber: event.blockNumber,
    blockTimestamp: event.blockTimestamp,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex
  };
}

export function toDgaiStakingEventEntity(event: IndexedEvent): DgaiStakingEventEntity | null {
  const args = event.args;

  switch (event.eventName) {
    case 'Stake':
      return {
        ...base(event),
        eventName: 'Stake',
        nodeId: asString(args.nodeId),
        staker: asAddress(args.staker),
        day: asString(args.day),
        amount: asString(args.amount),
        isHandlePreStake: event.transactionFunctionName === 'handlePreStake'
      };
    case 'Unstake':
      return {
        ...base(event),
        eventName: 'Unstake',
        nodeId: asString(args.nodeId),
        staker: asAddress(args.staker),
        requestId: asString(args.requestId),
        day: asString(args.day),
        amount: asString(args.amount),
        releaseTime: asString(args.releaseTime)
      };
    case 'Claim':
      return {
        ...base(event),
        eventName: 'Claim',
        nodeId: asString(args.nodeId),
        staker: asAddress(args.staker),
        day: asString(args.day),
        amount: asString(args.amount)
      };
    case 'ClaimUnstake':
      return {
        ...base(event),
        eventName: 'ClaimUnstake',
        staker: asAddress(args.staker),
        requestId: asString(args.requestId),
        amount: asString(args.amount)
      };
    case 'CancelUnstake':
      return {
        ...base(event),
        eventName: 'CancelUnstake',
        nodeId: asString(args.nodeId),
        staker: asAddress(args.staker),
        cancelRequestId: asString(args.cancelRequestId),
        day: asString(args.day),
        amount: asString(args.amount)
      };
    case 'ChangeNode':
      return {
        ...base(event),
        eventName: 'ChangeNode',
        user: asAddress(args.user),
        fromNodeId: asString(args.fromNodeId),
        toNodeId: asString(args.toNodeId),
        day: asString(args.day),
        amount: asString(args.amount),
        canceledPendingUnstake: asString(args.canceledPendingUnstake),
        cancelRequestIds: asStringArray(args.cancelRequestIds)
      };
    case 'RestakeRewardCall':
      return {
        ...base(event),
        eventName: 'RestakeRewardCall',
        user: asAddress(args.user),
        selectNodeId: asString(args.selectNodeId),
        day: asString(args.day),
        amount: asString(args.amount)
      };
    case 'RestakeDGAI':
      return {
        ...base(event),
        eventName: 'RestakeDGAI',
        user: asAddress(args.user),
        sourceNodeId: asString(args.sourceNodeId),
        sourceDay: asString(args.sourceDay),
        targetNodeId: asString(args.targetNodeId),
        targetDay: asString(args.targetDay),
        amount: asString(args.amount)
      };
    case 'Harvest':
      return {
        ...base(event),
        eventName: 'Harvest',
        user: asAddress(args.user),
        amount: asString(args.amount),
        rewardToken: asAddress(args.rewardToken)
      };
    default:
      return null;
  }
}
