import { getAddress, type Address, type Hex } from 'viem';
import type { IndexedEvent, JsonValue } from '../types.js';

export const DGAI_STAKING_EVENT_NAMES = [
  'Stake',
  'Unstake',
  'Claim',
  'ClaimUnstake',
  'RestakeRewardCall',
  'RestakeDGAI'
] as const;

export const DGRID_STAKE_POOL_EVENT_NAMES = ['Harvest'] as const;

export type DgaiStakingEventName = (typeof DGAI_STAKING_EVENT_NAMES)[number];
export type DgridStakePoolEventName = (typeof DGRID_STAKE_POOL_EVENT_NAMES)[number];

export type ChainEventMeta = {
  contractAddress: Address;
  blockNumber: string;
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

function base(event: IndexedEvent): ChainEventMeta {
  return {
    contractAddress: event.contractAddress,
    blockNumber: event.blockNumber,
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
