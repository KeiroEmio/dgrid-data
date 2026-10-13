# DGrid Data API 接口列表

## 基础信息

```text
Base URL: https://ai-admin.dgrid.ai/data-api/v1
Swagger: https://ai-admin.dgrid.ai/data-api/v1/docs
```

说明：

```text
外部请求路径：/data-api/v1/*
网关/鉴权服务转发到 DGrid API 服务内部路径：/api/*
```

例如：

```text
https://ai-admin.dgrid.ai/data-api/v1/health
-> DGrid API 内部 /api/health
```

---

## 1. 健康检查

### GET `/health`

用途：检查 API 服务是否正常。

请求示例：

```bash
curl https://ai-admin.dgrid.ai/data-api/v1/health
```

返回示例：

```json
{
  "ok": true
}
```

---

## 2. 原始链上事件

### GET `/events`

用途：分页查询原始链上事件。

Query 参数：

| 参数 | 必填 | 类型 | 说明 | 示例 |
|---|---|---|---|---|
| contractName | 否 | string | 合约名称 | `DGAIStaking` / `DgridStakePool` |
| eventName | 否 | string | 事件名称 | `Stake` / `Unstake` / `Claim` / `RestakeDGAI` / `RestakeRewardCall` / `ClaimUnstake` / `Harvest` |
| fromBlock | 否 | string | 起始区块 | `117963796` |
| toBlock | 否 | string | 结束区块 | `124000000` |
| limit | 否 | number | 每页数量 | `20` |
| offset | 否 | number | 偏移量 | `0` |

请求示例：

```bash
curl "https://ai-admin.dgrid.ai/data-api/v1/events?limit=20&offset=0"
curl "https://ai-admin.dgrid.ai/data-api/v1/events?contractName=DGAIStaking&eventName=Stake&limit=20&offset=0"
```

返回结构：

```ts
type EventsResponse = {
  limit: number;
  offset: number;
  items: Array<{
    contractName: string;
    contractAddress: string;
    eventName: string;
    blockNumber: string;
    transactionHash: string;
    logIndex: number;
    args: Record<string, unknown>;
    createdAt: string;
  }>;
};
```

---

### GET `/events/summary`

用途：统计原始事件数量。

请求示例：

```bash
curl https://ai-admin.dgrid.ai/data-api/v1/events/summary
```

返回结构：

```ts
type EventsSummaryResponse = Array<{
  contractName: string;
  eventName: string;
  count: number;
}>;
```

---

## 3. 爬虫状态

### GET `/indexer/states`

用途：查询当前爬虫进度、下次开始区块、错误状态等。

请求示例：

```bash
curl https://ai-admin.dgrid.ai/data-api/v1/indexer/states
```

返回结构：

```ts
type IndexerStatesResponse = Array<{
  indexerName: string;
  nextBlock: string;
  lastSyncedBlock: string | null;
  status: string;
  lastError: string | null;
  updatedAt: string;
}>;
```

---

## 4. StakePool 挖矿统计

数据来源：`DgridStakePool`、`Harvest`、`RestakeRewardCall`、accPerShare 释放逻辑。

推荐前端使用这三个接口：

```text
GET /stakePool/mining/overview
GET /stakePool/mining/trend
GET /stakePool/mining/flows
```

---

### GET `/stakePool/mining/overview`

用途：挖矿统计页面顶部累计数据。

请求示例：

```bash
curl https://ai-admin.dgrid.ai/data-api/v1/stakePool/mining/overview
```

返回结构：

```ts
type MiningOverviewResponse = {
  earnedRaw: string;
  restaked180Raw: string;
  restaked360Raw: string;
  claimedNetRaw: string;
  rewardFeeRaw: string;
  pendingRaw: string;
  restakeConversionRate: string;
};
```

字段说明：

| 字段 | 说明 |
|---|---|
| earnedRaw | 累计挖矿收益，raw 18 位精度 |
| restaked180Raw | 累计复投 180 天金额 |
| restaked360Raw | 累计复投 360 天金额 |
| claimedNetRaw | 累计领取到账金额 |
| rewardFeeRaw | 累计 Harvest 手续费 |
| pendingRaw | 未处理收益 |
| restakeConversionRate | 收益复投率 |

---

### GET `/stakePool/mining/trend`

用途：挖矿收益趋势图。

Query 参数：

| 参数 | 必填 | 类型 | 说明 | 默认值 | 示例 |
|---|---|---|---|---|---|
| days | 否 | number | 最近多少天，范围 1-365 | `30` | `30` |
| interval | 否 | string | 时间粒度，目前只支持 `day` | `day` | `day` |

请求示例：

```bash
curl "https://ai-admin.dgrid.ai/data-api/v1/stakePool/mining/trend?days=30&interval=day"
```

返回结构：

```ts
type MiningTrendResponse = {
  interval: 'day';
  days: number;
  items: Array<{
    date: string;
    claimedNetRaw: string;
    restaked180Raw: string;
    restaked360Raw: string;
    claimedEvents: number;
    restakeEvents: number;
  }>;
};
```

---

### GET `/stakePool/mining/flows`

用途：挖矿收益流水表。

Query 参数：

| 参数 | 必填 | 类型 | 说明 | 示例 |
|---|---|---|---|---|
| wallet | 否 | string | 钱包地址过滤 | `0x...` |
| action | 否 | string | 流水类型 | `claim` / `restake` |
| day | 否 | number | 复投周期 | `180` / `360` |
| limit | 否 | number | 每页数量，默认 50，最大 200 | `20` |
| offset | 否 | number | 偏移量 | `0` |

请求示例：

```bash
curl "https://ai-admin.dgrid.ai/data-api/v1/stakePool/mining/flows?limit=20&offset=0"
curl "https://ai-admin.dgrid.ai/data-api/v1/stakePool/mining/flows?action=restake&day=180&limit=20&offset=0"
curl "https://ai-admin.dgrid.ai/data-api/v1/stakePool/mining/flows?wallet=0x0000000000000000000000000000000000000000&limit=20&offset=0"
```

返回结构：

```ts
type MiningFlowsResponse = {
  limit: number;
  offset: number;
  items: Array<{
    action: 'claim' | 'restake';
    wallet: string;
    day: string | null;
    amountRaw: string;
    feeRaw: string;
    transactionHash: string;
    blockNumber: string;
    logIndex: number;
    createdAt: string;
  }>;
};
```

---

## 5. Staking 质押收益统计

数据来源：`DGAIStaking`、`Stake`、`Unstake`、`Claim`、`RestakeDGAI`、`ClaimUnstake`、fixedRate 增量状态表。

推荐前端使用这三个接口：

```text
GET /staking/overview
GET /staking/trend
GET /staking/flows
```

---

### GET `/staking/overview`

用途：质押统计页面顶部累计数据和当前质押本金模块。

请求示例：

```bash
curl https://ai-admin.dgrid.ai/data-api/v1/staking/overview
```

返回结构：

```ts
type StakingOverviewResponse = {
  earnedRaw: string;
  claimedNetRaw: string;
  pendingRaw: string;
  unprocessedRaw: string;
  restaked180Raw: string;
  restaked360Raw: string;
  restakeConversionRate: string;
  cumulativeRestakeRate: string;
  principalRaw: string;
  activeRaw: string;
  unlockingRaw: string;
  withdrawableRaw: string;
};
```

字段说明：

| 字段 | 说明 |
|---|---|
| earnedRaw | 累计质押收益，raw 18 位精度 |
| claimedNetRaw | 累计收益到账 |
| pendingRaw | 待领取收益，口径为 `earnedRaw - claimedNetRaw`，不扣复投 |
| unprocessedRaw | 未处理收益，口径为 `earnedRaw - claimedNetRaw - restaked180Raw - restaked360Raw` |
| restaked180Raw | 累计复投 180 天金额 |
| restaked360Raw | 累计复投 360 天金额 |
| restakeConversionRate | 累计收益复投率 |
| cumulativeRestakeRate | 累计收益复投率，兼容字段 |
| principalRaw | 当前计息本金总额 |
| activeRaw | 活跃本金 |
| unlockingRaw | 解锁中本金 |
| withdrawableRaw | 到期可提本金 |

---

### GET `/staking/trend`

用途：质押收益趋势图和区间分析。

Query 参数：

| 参数 | 必填 | 类型 | 说明 | 默认值 | 示例 |
|---|---|---|---|---|---|
| days | 否 | number | 最近多少天，范围 1-365 | `30` | `30` |
| interval | 否 | string | 时间粒度，目前只支持 `day` | `day` | `day` |

请求示例：

```bash
curl "https://ai-admin.dgrid.ai/data-api/v1/staking/trend?days=30&interval=day"
```

返回结构：

```ts
type StakingTrendResponse = {
  interval: 'day';
  days: number;
  items: Array<{
    date: string;
    claimedNetRaw: string;
    restaked180Raw: string;
    restaked360Raw: string;
    stakeRaw: string;
    unstakeRaw: string;
    claimUnstakeRaw: string;
    claimEvents: number;
    restakeEvents: number;
    stakeEvents: number;
    unstakeEvents: number;
    claimUnstakeEvents: number;
  }>;
};
```

---

### GET `/staking/flows`

用途：质押收益流水表。

Query 参数：

| 参数 | 必填 | 类型 | 说明 | 示例 |
|---|---|---|---|---|
| wallet | 否 | string | 钱包地址过滤 | `0x...` |
| action | 否 | string | 流水类型 | `stake` / `unstake` / `claim` / `restake` / `claimUnstake` |
| day | 否 | number | 质押周期 | `180` / `360` |
| limit | 否 | number | 每页数量，默认 50，最大 200 | `20` |
| offset | 否 | number | 偏移量 | `0` |

请求示例：

```bash
curl "https://ai-admin.dgrid.ai/data-api/v1/staking/flows?limit=20&offset=0"
curl "https://ai-admin.dgrid.ai/data-api/v1/staking/flows?action=stake&day=180&limit=20&offset=0"
curl "https://ai-admin.dgrid.ai/data-api/v1/staking/flows?action=restake&day=360&limit=20&offset=0"
curl "https://ai-admin.dgrid.ai/data-api/v1/staking/flows?wallet=0x0000000000000000000000000000000000000000&limit=20&offset=0"
```

返回结构：

```ts
type StakingFlowsResponse = {
  limit: number;
  offset: number;
  items: Array<{
    action: 'stake' | 'unstake' | 'claim' | 'restake' | 'claimUnstake';
    wallet: string;
    day: string | null;
    amountRaw: string;
    transactionHash: string;
    blockNumber: string;
    logIndex: number;
    createdAt: string;
  }>;
};
```

---

## 6. 底层统计接口

这些接口主要用于调试或兼容旧页面，前端主页面优先使用 mining/staking 三件套接口。

### GET `/stakePool/restakeReward/:day/sum`

用途：统计 `RestakeRewardCall` 指定周期的复投总额。

Path 参数：

| 参数 | 必填 | 类型 | 说明 | 示例 |
|---|---|---|---|---|
| day | 是 | number | 复投周期 | `180` / `360` |

请求示例：

```bash
curl https://ai-admin.dgrid.ai/data-api/v1/stakePool/restakeReward/180/sum
curl https://ai-admin.dgrid.ai/data-api/v1/stakePool/restakeReward/360/sum
```

返回结构：

```ts
type RestakeRewardSumResponse = {
  day: string;
  amountRaw: string;
  amountDgai: string;
};
```

---

### GET `/stakePool/accpershareReward/get`

用途：按当前 latest block 计算 StakePool accPerShare 总释放收益。

请求示例：

```bash
curl https://ai-admin.dgrid.ai/data-api/v1/stakePool/accpershareReward/get
```

返回结构：

```ts
type AccPerShareRewardResponse = {
  from_block: string;
  latest_block: string;
  reward_block_count: string;
  per_block_share_raw: string;
  total_reward_raw: string;
  total_dgai: string;
};
```

---

### GET `/stakePool/accpershareReward/claimInfo/get`

用途：StakePool accPerShare 收益领取、扣费、复投和未处理收益统计。

请求示例：

```bash
curl https://ai-admin.dgrid.ai/data-api/v1/stakePool/accpershareReward/claimInfo/get
```

返回结构：

```ts
type AccPerShareClaimInfoResponse = {
  earnedRaw: string;
  claimedNetRaw: string;
  rewardFeeRaw: string;
  pendingRaw: string;
  restaked180Raw: string;
  restaked360Raw: string;
  restakeConversionRate: string;
};
```

---

### GET `/stakePool/fixedRateReward/claimInfo/get`

用途：fixedRate 质押收益统计，staking overview 的底层来源。

请求示例：

```bash
curl https://ai-admin.dgrid.ai/data-api/v1/stakePool/fixedRateReward/claimInfo/get
```

返回结构：

```ts
type FixedRateClaimInfoResponse = {
  earnedRaw: string;
  claimedNetRaw: string;
  pendingRaw: string;
  unprocessedRaw: string;
  restaked180Raw: string;
  restaked360Raw: string;
  restakeConversionRate: string;
  cumulativeRestakeRate: string;
  principalRaw: string;
  activeRaw: string;
  unlockingRaw: string;
  withdrawableRaw: string;
  counts: {
    lifetimeRewardWallets: number;
    currentPendingWallets: number;
  };
};
```

---

## 7. 前端推荐接入清单

挖矿页面：

```text
GET https://ai-admin.dgrid.ai/data-api/v1/stakePool/mining/overview
GET https://ai-admin.dgrid.ai/data-api/v1/stakePool/mining/trend?days=30&interval=day
GET https://ai-admin.dgrid.ai/data-api/v1/stakePool/mining/flows?limit=20&offset=0
```

质押页面：

```text
GET https://ai-admin.dgrid.ai/data-api/v1/staking/overview
GET https://ai-admin.dgrid.ai/data-api/v1/staking/trend?days=30&interval=day
GET https://ai-admin.dgrid.ai/data-api/v1/staking/flows?limit=20&offset=0
```

调试接口：

```text
GET https://ai-admin.dgrid.ai/data-api/v1/health
GET https://ai-admin.dgrid.ai/data-api/v1/docs
GET https://ai-admin.dgrid.ai/data-api/v1/indexer/states
GET https://ai-admin.dgrid.ai/data-api/v1/events?limit=20&offset=0
GET https://ai-admin.dgrid.ai/data-api/v1/events/summary
```
