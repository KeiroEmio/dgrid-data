# DGrid 质押快照 API 对接文档

本文面向需要从 DGrid Data API 同步每日质押快照的服务端开发人员。

## 1. 基础信息

```text
Base URL: https://ai-admin.dgrid.ai/data-api/v1
数据时间基准: UTC
数据格式: JSON 或 NDJSON
当前 schemaVersion: 1
```

当前接口无需在 URL 中附加 API Key。如果网关后续增加认证，以网关配置为准。

快照每天以 UTC 00:00 为目标时间，使用该时刻之前最后一个链上区块的状态。只有状态为 `completed` 的快照才会通过查询和导出接口返回。

## 2. 推荐接入流程

推荐消费端按以下流程同步：

1. 调用 `GET /staking/snapshots` 获取已经完成的快照日期。
2. 找出本地尚未同步的日期。
3. 使用 JSON 分页接口或 NDJSON 接口同步指定日期。
4. 以 `(snapshotDate, wallet, nodeId, day)` 作为数据库唯一键执行 upsert。
5. 每次数据成功落库后，再持久化对应的 `cursor`。
6. 请求中断时，带上最后一个已经成功落库的 cursor 继续请求。
7. `nextCursor` 为 `null` 时，当前日期范围同步完成。

不要解析或自行拼接 cursor。cursor 是不透明字符串，并且与请求的 `from`、`to` 日期范围绑定。

## 3. 查询可用快照

### 请求

```http
GET /staking/snapshots
```

```bash
curl -sS \
  "https://ai-admin.dgrid.ai/data-api/v1/staking/snapshots"
```

### 响应示例

```json
[
  {
    "snapshotDate": "2026-11-09",
    "blockNumber": "132484801",
    "blockTimestamp": "1794182400",
    "blockHash": "0xb5b14ef9cff41c06613e9c7e057c18fe01ebbc30fa3e670b57fc581b9a890830",
    "totalWallets": "71760",
    "storedWallets": "..."
  }
]
```

字段说明：

| 字段 | 说明 |
|---|---|
| snapshotDate | UTC 快照日期，格式为 `YYYY-MM-DD` |
| blockNumber | 本次快照对应的链上区块 |
| blockTimestamp | 区块 Unix 时间戳，单位为秒 |
| blockHash | 区块哈希，可用于校验快照来源 |
| totalWallets | 本次快照任务实际检查的候选钱包数，仅用于观察任务处理规模 |
| storedWallets | 在快照区块读取到 nodeId 2/3 position 的钱包数 |

`totalWallets` 不是最终导出钱包数，也不能直接与链上 `nodeStakers` 比较。候选集合来自截至快照区块曾在 nodeId 2/3 发生 Stake，或曾通过 ChangeNode 迁入 nodeId 2/3 的去重地址。链上计数可能按节点累计，同一钱包可能被计算多次；导出数据以实际 position 记录为准。候选筛选策略可能随实现优化，因此不要把 `totalWallets` 当作业务统计指标进行跨日趋势分析。

## 4. JSON 分页导出

适合常规服务端同步、调试和较小分页。

### 请求

```http
GET /staking/snapshots/export
```

Query 参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| from | 是 | 起始 UTC 快照日期，`YYYY-MM-DD`，包含当天 |
| to | 是 | 结束 UTC 快照日期，`YYYY-MM-DD`，包含当天 |
| limit | 否 | 每页 position 数，默认 `1000`，范围 `1-5000` |
| cursor | 否 | 上一页的 `nextCursor`，首次请求不传 |

首次请求：

```bash
curl -sS \
  "https://ai-admin.dgrid.ai/data-api/v1/staking/snapshots/export?from=2026-11-09&to=2026-11-09&limit=1000"
```

继续下一页：

```bash
curl -sS \
  "https://ai-admin.dgrid.ai/data-api/v1/staking/snapshots/export?from=2026-11-09&to=2026-11-09&limit=1000&cursor=<nextCursor>"
```

### 响应结构

```ts
type SnapshotExportResponse = {
  schemaVersion: 1;
  from: string;
  to: string;
  items: SnapshotPosition[];
  nextCursor: string | null;
};

type SnapshotPosition = {
  cursor: string;
  snapshotDate: string;
  blockNumber: string;
  blockTimestamp: string;
  blockHash: string;
  wallet: string;
  nodeId: string;
  day: string;
  nodeStatus: string;
  nodeOwner: string;
  pendingReward: string;
  lastClaimTime: string;
  amount: string;
  pendingUnstake: string;
  unpaid: string;
  claimedAmount: string;
};
```

分页固定按以下字段升序排列：

```text
snapshotDate, wallet, nodeId, day
```

每条记录的 `cursor` 表示“从这条记录之后继续”。页末 `nextCursor` 等于当前页最后一条记录的 cursor；没有下一页时为 `null`。

## 5. NDJSON 流式导出

适合数据量较大的逐行处理。响应使用 HTTPS chunked 传输，不需要先把完整响应加载到内存。

### 请求

```http
GET /staking/snapshots/export.ndjson
```

参数与 JSON 分页接口相同。

```bash
curl -sS --no-buffer \
  "https://ai-admin.dgrid.ai/data-api/v1/staking/snapshots/export.ndjson?from=2026-11-09&to=2026-11-09&limit=5000"
```

该命令只输出到终端，不会创建下载文件。

### 响应格式

每行都是一个独立 JSON 对象：

```jsonl
{"type":"metadata","schemaVersion":1,"from":"2026-11-09","to":"2026-11-09"}
{"type":"position","cursor":"...","snapshotDate":"2026-11-09","wallet":"0x...","nodeId":"2","day":"180","amount":"..."}
{"type":"checkpoint","rowCount":5000,"nextCursor":"..."}
```

记录类型：

| type | 说明 |
|---|---|
| metadata | 当前响应的版本和日期范围 |
| position | 一条快照 position，字段与 JSON 接口相同 |
| checkpoint | 当前页结束信息及下一页 cursor |

响应头还会提供：

```text
Content-Type: application/x-ndjson; charset=utf-8
X-Export-Schema-Version: 1
X-Next-Cursor: <cursor>
```

当没有下一页时不会返回 `X-Next-Cursor`，末行 `checkpoint.nextCursor` 为 `null`。

## 6. 断点续传规则

JSON 和 NDJSON 使用相同的 cursor 协议。

- 首次请求不传 cursor。
- JSON 请求完成一页后，保存 `nextCursor`。
- NDJSON 应在每条 position 成功落库后保存该条记录的 `cursor`。
- 连接中断后，使用最后一条已经成功落库的 cursor 重新请求。
- 必须保持原请求的 `from`、`to` 不变。
- cursor 无效、损坏或与日期范围不一致时，接口返回 HTTP 400。
- 消费端仍必须使用唯一键 upsert，以处理“数据已落库但 cursor 尚未保存”造成的少量重放。

推荐的消费端状态表：

```text
sync_name
from_date
to_date
last_cursor
updated_at
```

推荐的数据唯一键：

```text
(snapshot_date, wallet, node_id, day)
```

## 7. Node.js JSON 分页示例

以下示例使用 Node.js 20+ 内置 `fetch`。`upsertPositions` 和 `saveCursor` 需要替换为消费端自己的数据库操作。

```js
const baseUrl = 'https://ai-admin.dgrid.ai/data-api/v1';
const from = '2026-11-09';
const to = '2026-11-09';
let cursor = await loadSavedCursor(from, to);

while (true) {
  const url = new URL(`${baseUrl}/staking/snapshots/export`);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('limit', '5000');
  if (cursor) url.searchParams.set('cursor', cursor);

  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(60_000)
  });

  if (!response.ok) {
    throw new Error(`Snapshot export failed: ${response.status} ${await response.text()}`);
  }

  const page = await response.json();

  // 数据和 cursor 应在同一个数据库事务中提交。
  await transaction(async (database) => {
    await upsertPositions(database, page.items);
    await saveCursor(database, from, to, page.nextCursor);
  });

  cursor = page.nextCursor;
  if (!cursor) break;
}
```

## 8. 数值和业务口径

- 所有链上 uint 数值均以十进制字符串返回，消费端不要转成 JavaScript `number`。
- 金额字段为合约 raw value。需要展示 DGAI 时，由消费端按代币 decimals 转换。
- 地址统一返回小写。
- `amount` 为当前 position 主体金额；即使 `amount` 为 `0`，记录仍可能包含 `pendingUnstake`、`unpaid` 或历史 `claimedAmount`，不能只按 amount 是否大于零判断是否保留。
- 当前快照只保存 nodeId 2 和 3 的 position。
- `nodeStatus` 是链上状态数值，消费端应按约定枚举解释，不应把任意非零值直接视为正常。
- 一个钱包可以有多个 node/day position，因此钱包地址不是唯一键。

## 9. 状态码和重试

| HTTP 状态 | 含义 | 建议处理 |
|---|---|---|
| 200 | 请求成功 | 正常消费数据 |
| 400 | 日期、limit 或 cursor 无效 | 修正请求，不要盲目重试 |
| 404 | 按日期查询接口未找到已完成快照 | 稍后重新查询快照列表 |
| 429 | 网关限流 | 指数退避后重试 |
| 500/502/503/504 | 服务或网关暂时异常 | 使用相同 cursor 指数退避重试 |

建议设置连接和响应超时，并对 429、5xx 使用带随机抖动的指数退避。重试时必须使用最后一个已经提交成功的 cursor。

## 10. 快速联调命令

查看快照列表：

```bash
curl -sS \
  "https://ai-admin.dgrid.ai/data-api/v1/staking/snapshots"
```

查看两条 JSON 数据：

```bash
curl -sS \
  "https://ai-admin.dgrid.ai/data-api/v1/staking/snapshots/export?from=2026-11-09&to=2026-11-09&limit=2"
```

查看两条 NDJSON 数据和响应头：

```bash
curl -sS -i --no-buffer \
  "https://ai-admin.dgrid.ai/data-api/v1/staking/snapshots/export.ndjson?from=2026-11-09&to=2026-11-09&limit=2"
```

Swagger：

```text
https://ai-admin.dgrid.ai/data-api/v1/docs
```
