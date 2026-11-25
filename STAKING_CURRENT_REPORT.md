# 一次性全量质押数据报告

该任务在固定的 BSC 最新区块读取 `DGAIStaking.getPositions(wallet)`，将所有在爬虫事件库中出现过的质押地址的仓位导出为 CSV 文件。文件通过 Docker bind mount 写入服务器项目根目录。它是一次性程序，不会启动或重启 crawler、snapshot、API 服务，也不发送任何链上交易。

## 服务器上手动执行

先在服务器项目目录拉取包含该程序的代码，然后运行：

```bash
docker compose -f docker-compose.staking-current-report.yml run --build --rm staking-current-report
```

该命令会单独构建 `dgrid-data:staking-current-report` 镜像并以前台方式运行一次；完成后容器自动删除，镜像保留。CSV 会原子写入服务器项目根目录，文件名为 `staking-current-report-<区块高度>-<运行时间>.csv`。日志中的区块号、钱包数、position 数和文件路径可用于核对。若最新区块尚未被 crawler 索引，程序会等待最多 5 分钟；超时会失败退出，不会留下不完整的正式 CSV，可以等 crawler 追上后重新执行。

完成后可在项目根目录确认和导出文件：

```bash
ls -lh staking-current-report-*.csv
```

可以通过 `scp` 从服务器下载，例如从本地终端运行：

```bash
scp <服务器登录名>@<服务器地址>:<项目根目录>/staking-current-report-<区块高度>-<运行时间>.csv .
```

也可以调整 RPC 并发和数据库等待时间：

```bash
STAKING_CURRENT_REPORT_PAGE_SIZE=100 \
STAKING_CURRENT_REPORT_CONCURRENCY=5 \
STAKING_CURRENT_REPORT_INDEXER_WAIT_MS=300000 \
docker compose -f docker-compose.staking-current-report.yml run --build --rm \
  -e STAKING_CURRENT_REPORT_PAGE_SIZE \
  -e STAKING_CURRENT_REPORT_CONCURRENCY \
  -e STAKING_CURRENT_REPORT_INDEXER_WAIT_MS \
  staking-current-report
```

## CSV 字段

金额字段均为 18 位精度 raw 整数，保存在 PostgreSQL `numeric` 中：

- `amount_raw`：当前在仓本金。
- `pending_unstake_raw`：解锁中的本金。
- `principal_raw`：`amount_raw + pending_unstake_raw`。
- `pending_reward_raw`：合约 `getPositions` 返回的当前待领取收益（包含链上预览及已累计未领取部分，按合约返回原样保存）。
- `unpaid_raw`：仓位已结算但未领取收益字段。
- `claimed_amount_raw`：该仓位链上累计已领取金额。
- `tier_id`、`day`、`fixed_rate`：按 `getPositions` 原字段分别保存；3600 是新仓位标识，不是 3600 天。

该 CSV 记录的是 `getPositions` 在指定区块的仓位状态；`claimed_amount_raw` 是合约 position 字段，不等同于不区分仓位的全历史 Claim 事件总额。若要审计所有历史领取转账，应另按 `Claim` 事件表汇总。金额 raw 字段可能超过电子表格软件的精度限制；导入表格时应将这些列设为文本，避免自动舍入。
