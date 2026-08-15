import { Module } from '@nestjs/common';
import { ConversationModule } from 'src/modules/conversation/conversation.module';
import { IdentityModule } from 'src/modules/identity/identity.module';
import { MemoryModule } from 'src/modules/memory/memory.module';
import { PersonaModule } from 'src/modules/persona/persona.module';
import { PrivacyModule } from 'src/modules/privacy/privacy.module';
import { PublicDataModule } from 'src/modules/publicdata/publicdata.module';
import { ElderController } from './elder.controller';

/** 長者端與雙端共用 API（交接規格 §3）。 */
@Module({
  imports: [
    ConversationModule,
    MemoryModule,
    PersonaModule,
    PrivacyModule,
    PublicDataModule,
    IdentityModule,
  ],
  controllers: [ElderController],
})
export class ElderModule {}
