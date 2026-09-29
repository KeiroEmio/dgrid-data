import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module.js';
const port = Number(process.env.API_PORT ?? '3000');
async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.setGlobalPrefix('api');
    await app.listen(port);
    console.log(`API server listening on http://localhost:${port}/api`);
}
void bootstrap();
