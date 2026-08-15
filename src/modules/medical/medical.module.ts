import { Module } from '@nestjs/common';
import { MedicationService } from './medication.service';

/** Medical Journey 與藥品。未經人工確認不可建立用藥提醒（交接規格 §6）。 */
@Module({
  providers: [MedicationService],
  exports: [MedicationService],
})
export class MedicalModule {}
