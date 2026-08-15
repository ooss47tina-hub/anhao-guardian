import { Module } from '@nestjs/common';
import { PersonaService } from './persona.service';

/** AI Persona。Template 只改語氣，不改資料權限與安全規則（SRS F0-01）。 */
@Module({
  providers: [PersonaService],
  exports: [PersonaService],
})
export class PersonaModule {}
