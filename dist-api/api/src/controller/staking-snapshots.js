var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service.js';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
let StakingSnapshotsController = class StakingSnapshotsController {
    database;
    constructor(database) {
        this.database = database;
    }
    async listSnapshots() {
        const result = await this.database.query(`select snapshot_date::text, block_number::text, block_timestamp::text, block_hash,
        total_wallets::text, stored_wallets::text
       from staking_position_snapshots where status = 'completed'
       order by snapshot_date desc limit 100`);
        return result.rows.map((row) => this.toSnapshot(row));
    }
    async getSnapshot(date, limitQuery, afterQuery) {
        const parsedDate = new Date(`${date}T00:00:00Z`);
        if (!DATE_PATTERN.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
            throw new BadRequestException('date must be a valid YYYY-MM-DD date');
        }
        const limit = limitQuery === undefined ? 200 : Number(limitQuery);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
            throw new BadRequestException('limit must be an integer between 1 and 500');
        }
        let after;
        if (afterQuery !== undefined) {
            if (!/^0x[0-9a-fA-F]{40}$/.test(afterQuery))
                throw new BadRequestException('after must be a wallet address');
            after = afterQuery.toLowerCase();
        }
        const snapshotResult = await this.database.query(`select snapshot_date::text, block_number::text, block_timestamp::text, block_hash,
        total_wallets::text, stored_wallets::text
       from staking_position_snapshots where snapshot_date = $1 and status = 'completed'`, [date]);
        if (!snapshotResult.rowCount)
            throw new NotFoundException(`Completed snapshot not found for ${date}`);
        const snapshot = this.toSnapshot(snapshotResult.rows[0]);
        const walletResult = await this.database.query(`select distinct wallet from staking_position_snapshot_positions
       where snapshot_date = $1 and ($2::text is null or wallet > $2)
       order by wallet limit $3`, [date, after ?? null, limit + 1]);
        const hasMore = walletResult.rows.length > limit;
        const wallets = walletResult.rows.slice(0, limit).map((row) => row.wallet);
        const positionResult = wallets.length === 0
            ? { rows: [] }
            : await this.database.query(`select wallet, node_id::text, day::text, node_status::text, node_owner,
          pending_reward::text, last_claim_time::text, amount::text, pending_unstake::text,
          unpaid::text, claimed_amount::text
         from staking_position_snapshot_positions
         where snapshot_date = $1 and wallet = any($2::text[])
         order by wallet, node_id, day`, [date, wallets]);
        const byWallet = new Map();
        for (const row of positionResult.rows) {
            const positions = byWallet.get(row.wallet) ?? [];
            positions.push({
                nodeId: row.node_id,
                day: row.day,
                nodeStatus: row.node_status,
                nodeOwner: row.node_owner,
                pendingReward: row.pending_reward,
                lastClaimTime: row.last_claim_time,
                amount: row.amount,
                pendingUnstake: row.pending_unstake,
                unpaid: row.unpaid,
                claimedAmount: row.claimed_amount
            });
            byWallet.set(row.wallet, positions);
        }
        const items = wallets.map((wallet) => ({ wallet, positions: byWallet.get(wallet) ?? [] }));
        return {
            snapshot,
            items,
            nextCursor: hasMore && wallets.length > 0 ? wallets[wallets.length - 1] : null
        };
    }
    toSnapshot(row) {
        return {
            snapshotDate: row.snapshot_date,
            blockNumber: row.block_number,
            blockTimestamp: row.block_timestamp,
            blockHash: row.block_hash,
            totalWallets: row.total_wallets,
            storedWallets: row.stored_wallets
        };
    }
};
__decorate([
    ApiOperation({ summary: '列出已完成的每日质押快照' }),
    Get('snapshots'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], StakingSnapshotsController.prototype, "listSnapshots", null);
__decorate([
    ApiOperation({ summary: '按钱包游标分页读取每日质押快照' }),
    ApiQuery({ name: 'limit', required: false, example: '200' }),
    ApiQuery({ name: 'after', required: false, example: '0x0000000000000000000000000000000000000000' }),
    Get('snapshots/:date'),
    __param(0, Param('date')),
    __param(1, Query('limit')),
    __param(2, Query('after')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], StakingSnapshotsController.prototype, "getSnapshot", null);
StakingSnapshotsController = __decorate([
    ApiTags('staking'),
    Controller('staking'),
    __metadata("design:paramtypes", [DatabaseService])
], StakingSnapshotsController);
export { StakingSnapshotsController };
