import { Module } from '@nestjs/common';
import { BaselineModule } from 'src/modules/baseline/baseline.module';
import { DetectModule } from 'src/modules/detect/detect.module';
import { NotifyModule } from 'src/modules/notify/notify.module';
import { PublicDataModule } from 'src/modules/publicdata/publicdata.module';
import { JobsService } from './jobs.service';

/** 交接規格 §4 的排程作業。safety_rule 為即時觸發，不在此。 */
@Module({
  imports: [BaselineModule, DetectModule, NotifyModule, PublicDataModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class SchedulerModule {}
