import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export type EventQuery = {
  contractName?: string;
  eventName?: string;
  fromBlock?: string;
  toBlock?: string;
  limit?: string;
  offset?: string;
};

@Injectable()
export class EventsService {
  constructor(private readonly database: DatabaseService) {}

  async findEvents(query: EventQuery) {
    const where: string[] = [];
    const values: unknown[] = [];

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
    const result = await this.database.query(
      `select
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
      limit $${limitIndex} offset $${offsetIndex}`,
      values
    );

    return result.rows;
  }

  async getEventSummary() {
    const result = await this.database.query(
      `select
        contract_name,
        event_name,
        count(*)::integer as total_events,
        min(block_number)::text as min_block,
        max(block_number)::text as max_block
      from chain_events
      group by contract_name, event_name
      order by contract_name, event_name`
    );

    return result.rows;
  }
}
