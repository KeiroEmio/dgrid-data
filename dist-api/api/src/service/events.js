var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
let EventsService = class EventsService {
    database;
    constructor(database) {
        this.database = database;
    }
    async findEvents(query) {
        const where = [];
        const values = [];
        if (query.contractName) {
            values.push(query.contractName);
            where.push(`contract_name = $${values.length}`);
        }
        if (query.eventName) {
            values.push(query.eventName);
            where.push(`event_name = $${values.length}`);
        }
        if (query.fromBlock) {
            values.push(query.fromBlock);
            where.push(`block_number >= $${values.length}`);
        }
        if (query.toBlock) {
            values.push(query.toBlock);
            where.push(`block_number <= $${values.length}`);
        }
        const limit = Math.min(Number(query.limit ?? '50'), 200);
        const offset = Number(query.offset ?? '0');
        values.push(limit);
        const limitIndex = values.length;
        values.push(offset);
        const offsetIndex = values.length;
        const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : '';
        const result = await this.database.query(`select
        id,
        contract_name,
        contract_address,
        event_name,
        block_number,
        transaction_hash,
        log_index,
        args,
        created_at
      from chain_events
      ${whereSql}
      order by block_number desc, log_index desc
      limit $${limitIndex} offset $${offsetIndex}`, values);
        return result.rows;
    }
    async getEventSummary() {
        const result = await this.database.query(`select
        contract_name,
        event_name,
        count(*)::integer as total_events,
        min(block_number)::text as min_block,
        max(block_number)::text as max_block
      from chain_events
      group by contract_name, event_name
      order by contract_name, event_name`);
        return result.rows;
    }
};
EventsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService])
], EventsService);
export { EventsService };
