import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdaptersModule } from './adapters/adapters.module';
import { CoreModule } from './common/core.module';
import { configuration } from './common/config/configuration';
import { ALL_ENTITIES } from './database/entities';
import { AdminModule } from './modules/admin/admin.module';
import { ConsentModule } from './modules/consent/consent.module';
import { DevModule } from './modules/dev/dev.module';
import { ElderModule } from './modules/elder/elder.module';
import { GuardianModule } from './modules/guardian/guardian.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('database.url'),
        entities: ALL_ENTITIES,
        // 永遠 false。分區、trigger 與 CHECK 條件都在 migration 裡，
        // 讓 ORM 自動同步會把它們刪掉。
        synchronize: false,
        logging: config.get<string>('env') === 'development',
      }),
    }),

    ScheduleModule.forRoot(),

    AdaptersModule,
    CoreModule,

    // 有 controller 的模組。其餘領域模組由這些模組間接載入。
    IngestModule,
    ElderModule,
    GuardianModule,
    ConsentModule,
    AdminModule,
    SchedulerModule,

    // 開發檢視頁（/dev）。正式環境不載入；DevController 內另有 404 雙保險。
    ...(process.env.NODE_ENV === 'production' ? [] : [DevModule]),
  ],
})
export class AppModule {}
