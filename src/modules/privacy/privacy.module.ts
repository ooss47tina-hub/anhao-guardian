import { Module } from '@nestjs/common';
import { ConversationModule } from 'src/modules/conversation/conversation.module';
import { PrivacyService } from './privacy.service';

/** 資料可攜與刪除權。刪除不可逆、需二次確認（交接規格 §3、§6）。 */
@Module({
  imports: [ConversationModule],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
