import { Injectable } from '@nestjs/common';
import { getAddress } from 'viem';

@Injectable()
export class AppConfigService {
  readonly databaseUrl = this.requireEnv('DATABASE_URL');
  readonly rpcUrl = this.requireEnv('RPC_URL');
  readonly dgridPoolDgaiRewardStartBlock = BigInt(this.requireEnv('DGRID_POOL_DGAIREWARD_START_BLOCK'));
  readonly dgridPoolPerBlockShare = BigInt(
    process.env.DGRID_POOL_PERBLOCK_SHARE?.trim()
    ?? this.requireEnv('DGRID_POOL_PERBLCOK_SHARE').trim()
  );
  readonly dgridPoolHarvestFeeRaw = BigInt(this.requireEnv('DGRID_POOL_HARVEST_FEE').trim()) * BigInt('1000000000000000000');
  readonly dgaiAddress = getAddress(this.requireEnv('DGAI_ADDRESS'));

  private requireEnv(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing env: ${name}`);
    return value;
  }
}
