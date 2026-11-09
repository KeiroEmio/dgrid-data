import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, type QueryResultRow } from 'pg';
import { migrateStakingSnapshotSchema } from '../../../src/persistence/staking-snapshot-schema.js';
import { AppConfigService } from '../config/config.service.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy, OnModuleInit {
  private readonly pool: Pool;

  constructor(config: AppConfigService) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  async onModuleInit() {
    await migrateStakingSnapshotSchema(this.pool);
  }

  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) {
    return this.pool.query<T>(sql, values);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
