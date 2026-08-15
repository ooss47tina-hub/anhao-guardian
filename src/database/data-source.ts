import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from './entities';

// TypeORM CLI 不經過 NestJS，@nestjs/config 的 .env 載入不會發生。
// 少了這行，改過 .env 的 DATABASE_URL 仍會連到預設位址。
loadEnv();

/**
 * TypeORM CLI 用的 DataSource（migration:run / migration:revert）。
 * 應用程式本身透過 TypeOrmModule 取得連線，不使用這個實例。
 *
 * synchronize 永遠為 false —— 分區、trigger 與 CHECK 條件都在 migration 裡，
 * 讓 ORM 自動同步會把它們刪掉。
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgres://anhao:anhao@localhost:5432/anhao',
  entities: ALL_ENTITIES,
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});
