import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class IndexerService {
  constructor(private readonly database: DatabaseService) {}

  async findStates() {
    const result = await this.database.query(
      `select
        indexer_name,
        next_from_block,
        current_from_block,
        current_to_block,
        retry_count,
        last_error,
        updated_at
      from block_indexer
      order by indexer_name`
    );

    return result.rows;
  }
}
