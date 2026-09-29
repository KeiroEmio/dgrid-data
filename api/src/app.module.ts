import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { ApiModule } from './router/api.module.js';

@Module({
  imports: [ConfigModule, ApiModule]
})
export class AppModule { }
