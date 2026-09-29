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
import { Pool } from 'pg';
import { AppConfigService } from '../config/config.service.js';
let DatabaseService = class DatabaseService {
    pool;
    constructor(config) {
        this.pool = new Pool({ connectionString: config.databaseUrl });
    }
    query(sql, values) {
        return this.pool.query(sql, values);
    }
    async onModuleDestroy() {
        await this.pool.end();
    }
};
DatabaseService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [AppConfigService])
], DatabaseService);
export { DatabaseService };
