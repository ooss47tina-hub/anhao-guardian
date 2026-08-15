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

  /**
   * CORS：守護者端網頁（Next.js，開發時跑在 localhost:3001）跨埠呼叫本後端。
   * production 改由 CORS_ORIGINS 環境變數列舉正式網域，未設定則不開放。
   */
  const corsOrigins = process.env.CORS_ORIGINS?.split(',').filter(Boolean);
  app.enableCors({
    origin:
      process.env.NODE_ENV === 'production'
        ? (corsOrigins ?? false)
        : /^https?:\/\/localhost(:\d+)?$/,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
  logger.log(`安好 AI 自主生活守護 後端啟動於 :${port}`);
}

void bootstrap();
