import { Module } from '@nestjs/common';
import { BaselineModule } from 'src/modules/baseline/baseline.module';
import { GuardianController } from './guardian.controller';
import { GuardianViewService } from './guardian-view.service';

/**
 * 守護者端。
 * 刻意不 import ConversationModule —— 拿不到 MessageRepository，
 * 就沒有任何路徑能洩漏聊天原文（交接規格 §6）。
 */
@Module({
  imports: [BaselineModule],
  controllers: [GuardianController],
  providers: [GuardianViewService],
  exports: [GuardianViewService],
})
export class GuardianModule {}
