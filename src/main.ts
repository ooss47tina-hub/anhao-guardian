import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('bootstrap');

  /**
   * LINE Webhook 簽章驗證需要原始 body。
   * express 的 json parser 會把 body 轉成物件，重新 stringify 後的位元組
   * 不保證與原文相同（鍵順序、空白），簽章就會對不起來。
   */
  app.use(
    json({
      verify: (req, _res, buf: Buffer) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
  logger.log(`安好 AI 自主生活守護 後端啟動於 :${port}`);
}

void bootstrap();
