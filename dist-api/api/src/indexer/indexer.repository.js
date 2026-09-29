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
let IndexerRepository = class IndexerRepository {
    database;
    constructor(database) {
        this.database = database;
    }
    async findStates() {
        const result = await this.database.query(`select
        indexer_name,
        next_from_block,
        current_from_block,
        current_to_block,
        retry_count,
        last_error,
        updated_at
      from block_indexer
      order by indexer_name`);
        return result.rows;
    }
};
IndexerRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService])
], IndexerRepository);
export { IndexerRepository };
