import { Module } from '@nestjs/common';
import { ConversationModule } from 'src/modules/conversation/conversation.module';
import { MedicalModule } from 'src/modules/medical/medical.module';
import { IngestProcessor } from './ingest.processor';
import { IngestQueue } from './ingest.queue';
import { LineWebhookController } from './line-webhook.controller';

/** LINE Webhook 入口。驗簽 → 入佇列 → 3 秒內回 200（交接規格 §3）。 */
@Module({
  imports: [ConversationModule, MedicalModule],
  controllers: [LineWebhookController],
  providers: [IngestQueue, IngestProcessor],
  exports: [IngestQueue],
})
export class IngestModule {}
