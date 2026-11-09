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
import { once } from 'node:events';
import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service.js';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WALLET_PATTERN = /^0x[0-9a-f]{40}$/;
const EXPORT_SCHEMA_VERSION = 1;
const DEFAULT_EXPORT_LIMIT = 1_000;
const MAX_EXPORT_LIMIT = 5_000;
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
    async exportSnapshots(fromQuery, toQuery, limitQuery, cursorQuery) {
        const { from, to, limit, cursor } = this.parseExportQuery(fromQuery, toQuery, limitQuery, cursorQuery);
        const page = await this.readExportPage(from, to, limit, cursor);
        return {
            schemaVersion: EXPORT_SCHEMA_VERSION,
            from,
            to,
            items: page.items,
            nextCursor: page.nextCursor
        };
    }
    async streamSnapshots(response, fromQuery, toQuery, limitQuery, cursorQuery) {
        const { from, to, limit, cursor } = this.parseExportQuery(fromQuery, toQuery, limitQuery, cursorQuery);
        const page = await this.readExportPage(from, to, limit, cursor);
        response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Accel-Buffering', 'no');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Disposition', `attachment; filename="staking-snapshots-${from}-${to}.ndjson"`);
        response.setHeader('X-Export-Schema-Version', String(EXPORT_SCHEMA_VERSION));
        if (page.nextCursor)
            response.setHeader('X-Next-Cursor', page.nextCursor);
        response.flushHeaders();
        if (!await this.writeNdjson(response, {
            type: 'metadata',
            schemaVersion: EXPORT_SCHEMA_VERSION,
            from,
            to
        }))
            return;
        for (const item of page.items) {
            if (!await this.writeNdjson(response, { type: 'position', ...item }))
                return;
        }
        if (!await this.writeNdjson(response, {
            type: 'checkpoint',
            rowCount: page.items.length,
            nextCursor: page.nextCursor
        }))
            return;
        response.end();
    }
    async getSnapshot(date, limitQuery, afterQuery) {
        this.requireDate(date, 'date');
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
    parseExportQuery(fromQuery, toQuery, limitQuery, cursorQuery) {
        if (fromQuery === undefined)
            throw new BadRequestException('from is required');
        if (toQuery === undefined)
            throw new BadRequestException('to is required');
        const from = this.requireDate(fromQuery, 'from');
        const to = this.requireDate(toQuery, 'to');
        if (from > to)
            throw new BadRequestException('from must be less than or equal to to');
        const limit = limitQuery === undefined ? DEFAULT_EXPORT_LIMIT : Number(limitQuery);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EXPORT_LIMIT) {
            throw new BadRequestException(`limit must be an integer between 1 and ${MAX_EXPORT_LIMIT}`);
        }
        const cursor = cursorQuery === undefined ? null : this.decodeCursor(cursorQuery, from, to);
        return { from, to, limit, cursor };
    }
    requireDate(value, name) {
        const parsed = new Date(`${value}T00:00:00Z`);
        if (!DATE_PATTERN.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
            throw new BadRequestException(`${name} must be a valid YYYY-MM-DD date`);
        }
        return value;
    }
    decodeCursor(value, from, to) {
        if (value.length > 2_048)
            throw new BadRequestException('cursor is invalid');
        try {
            const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
            if (parsed.version !== EXPORT_SCHEMA_VERSION ||
                parsed.from !== from ||
                parsed.to !== to ||
                typeof parsed.snapshotDate !== 'string' ||
                this.requireDate(parsed.snapshotDate, 'cursor snapshotDate') !== parsed.snapshotDate ||
                typeof parsed.wallet !== 'string' ||
                !WALLET_PATTERN.test(parsed.wallet) ||
                typeof parsed.nodeId !== 'string' ||
                !/^\d+$/.test(parsed.nodeId) ||
                typeof parsed.day !== 'string' ||
                !/^\d+$/.test(parsed.day)) {
                throw new Error('invalid cursor payload');
            }
            if (parsed.snapshotDate < from || parsed.snapshotDate > to)
                throw new Error('cursor is outside the date range');
            return parsed;
        }
        catch (error) {
            if (error instanceof BadRequestException)
                throw error;
            throw new BadRequestException('cursor is invalid or does not match from/to');
        }
    }
    encodeCursor(row, from, to) {
        const cursor = {
            version: EXPORT_SCHEMA_VERSION,
            from,
            to,
            snapshotDate: row.snapshot_date,
            wallet: row.wallet,
            nodeId: row.node_id,
            day: row.day
        };
        return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
    }
    async readExportPage(from, to, limit, cursor) {
        const result = await this.database.query(`select
        snapshots.snapshot_date::text,
        snapshots.block_number::text,
        snapshots.block_timestamp::text,
        snapshots.block_hash,
        positions.wallet,
        positions.node_id::text,
        positions.day::text,
        positions.node_status::text,
        positions.node_owner,
        positions.pending_reward::text,
        positions.last_claim_time::text,
        positions.amount::text,
        positions.pending_unstake::text,
        positions.unpaid::text,
        positions.claimed_amount::text
       from staking_position_snapshot_positions positions
       join staking_position_snapshots snapshots using (snapshot_date)
       where snapshots.status = 'completed'
         and snapshots.snapshot_date between $1::date and $2::date
         and (
           $3::date is null
           or positions.snapshot_date > $3::date
           or (positions.snapshot_date = $3::date and positions.wallet > $4::text)
           or (positions.snapshot_date = $3::date and positions.wallet = $4::text and positions.node_id > $5::numeric)
           or (positions.snapshot_date = $3::date and positions.wallet = $4::text and positions.node_id = $5::numeric and positions.day > $6::numeric)
         )
       order by positions.snapshot_date, positions.wallet, positions.node_id, positions.day
       limit $7`, [from, to, cursor?.snapshotDate ?? null, cursor?.wallet ?? null, cursor?.nodeId ?? null, cursor?.day ?? null, limit + 1]);
        const hasMore = result.rows.length > limit;
        const rows = result.rows.slice(0, limit);
        const items = rows.map((row) => ({
            cursor: this.encodeCursor(row, from, to),
            snapshotDate: row.snapshot_date,
            blockNumber: row.block_number,
            blockTimestamp: row.block_timestamp,
            blockHash: row.block_hash,
            wallet: row.wallet,
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
        }));
        return {
            items,
            nextCursor: hasMore && items.length > 0 ? items[items.length - 1].cursor : null
        };
    }
    async writeNdjson(response, value) {
        if (response.destroyed || response.writableEnded)
            return false;
        if (response.write(`${JSON.stringify(value)}\n`))
            return true;
        await Promise.race([once(response, 'drain'), once(response, 'close')]);
        return !response.destroyed && !response.writableEnded;
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
    ApiOperation({ summary: '按日期范围和稳定游标分页导出已完成的质押快照' }),
    ApiQuery({ name: 'from', required: true, example: '2026-11-01' }),
    ApiQuery({ name: 'to', required: true, example: '2026-11-09' }),
    ApiQuery({ name: 'limit', required: false, example: '1000' }),
    ApiQuery({ name: 'cursor', required: false, description: '上一页返回的 nextCursor' }),
    Get('snapshots/export'),
    __param(0, Query('from')),
    __param(1, Query('to')),
    __param(2, Query('limit')),
    __param(3, Query('cursor')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", Promise)
], StakingSnapshotsController.prototype, "exportSnapshots", null);
__decorate([
    ApiOperation({ summary: '以 NDJSON 流导出已完成的质押快照，每条记录均可续传' }),
    ApiProduces('application/x-ndjson'),
    ApiQuery({ name: 'from', required: true, example: '2026-11-01' }),
    ApiQuery({ name: 'to', required: true, example: '2026-11-09' }),
    ApiQuery({ name: 'limit', required: false, example: '1000' }),
    ApiQuery({ name: 'cursor', required: false, description: '最后成功处理记录的 cursor' }),
    Get('snapshots/export.ndjson'),
    __param(0, Res()),
    __param(1, Query('from')),
    __param(2, Query('to')),
    __param(3, Query('limit')),
    __param(4, Query('cursor')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Function, String, String, String, String]),
    __metadata("design:returntype", Promise)
], StakingSnapshotsController.prototype, "streamSnapshots", null);
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
