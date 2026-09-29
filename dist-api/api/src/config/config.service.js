var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from '@nestjs/common';
import { getAddress } from 'viem';
let AppConfigService = class AppConfigService {
    databaseUrl = this.requireEnv('DATABASE_URL');
    rpcUrl = this.requireEnv('RPC_URL');
    dgridPoolDgaiRewardStartBlock = BigInt(this.requireEnv('DGRID_POOL_DGAIREWARD_START_BLOCK'));
    dgridPoolPerBlockShare = BigInt(process.env.DGRID_POOL_PERBLOCK_SHARE?.trim()
        ?? this.requireEnv('DGRID_POOL_PERBLCOK_SHARE').trim());
    dgridPoolHarvestFeeRaw = BigInt(this.requireEnv('DGRID_POOL_HARVEST_FEE').trim()) * BigInt('1000000000000000000');
    dgaiAddress = getAddress(this.requireEnv('DGAI_ADDRESS'));
    requireEnv(name) {
        const value = process.env[name];
        if (!value)
            throw new Error(`Missing env: ${name}`);
        return value;
    }
};
AppConfigService = __decorate([
    Injectable()
], AppConfigService);
export { AppConfigService };
