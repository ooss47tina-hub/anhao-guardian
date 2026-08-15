import { Module } from '@nestjs/common';
import { ExtractModule } from 'src/modules/extract/extract.module';
import { GuardianModule } from 'src/modules/guardian/guardian.module';
import { SchedulerModule } from 'src/scheduler/scheduler.module';
import { DevController } from './dev.controller';

/**
 * 開發用檢視頁。僅在非 production 載入（見 AppModule），
 * DevController 內另有 assertDev 雙保險。
 */
@Module({
  imports: [GuardianModule, ExtractModule, SchedulerModule],
  controllers: [DevController],
})
export class DevModule {}
