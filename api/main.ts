import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './src/app.module.js';

const port = Number(process.env.API_PORT ?? '3000');

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.setGlobalPrefix('api');

    const swaggerConfig = new DocumentBuilder()
        .setTitle('DGrid Data API')
        .setDescription('DGrid 链上数据统计 API')
        .setVersion('0.1.0')
        .addTag('stakePool')
        .addTag('staking')
        .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);

    await app.listen(port);

    console.log(`API server listening on http://localhost:${port}/api`);
    console.log(`Swagger docs listening on http://localhost:${port}/api/docs`);
}

void bootstrap();
