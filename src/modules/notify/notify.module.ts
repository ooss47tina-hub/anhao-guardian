import { Module } from '@nestjs/common';
import { BaselineModule } from 'src/modules/baseline/baseline.module';
import { DigestService } from './digest.service';
import { NotificationService } from './notification.service';

/** 通知與週摘要。被抑制者仍寫入並記 suppressed_reason（交接規格 §2.4）。 */
@Module({
  imports: [BaselineModule],
  providers: [NotificationService, DigestService],
  exports: [NotificationService, DigestService],
})
export class NotifyModule {}
