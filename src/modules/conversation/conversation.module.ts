import { Module } from '@nestjs/common';
import { ExtractModule } from 'src/modules/extract/extract.module';
import { MemoryModule } from 'src/modules/memory/memory.module';
import { NotifyModule } from 'src/modules/notify/notify.module';
import { ConversationService } from './conversation.service';
import { MessageRepository } from './message.repository';

/**
 * 對話。MessageRepository 是 message.text 的唯一存取入口 ——
 * 守護者端模組刻意不 import 這個模組（交接規格 §6）。
 */
@Module({
  imports: [ExtractModule, MemoryModule, NotifyModule],
  providers: [ConversationService, MessageRepository],
  exports: [ConversationService, MessageRepository],
})
export class ConversationModule {}
