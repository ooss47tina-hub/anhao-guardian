import { Module } from '@nestjs/common';
import { ExtractModule } from 'src/modules/extract/extract.module';
import { MedicalModule } from 'src/modules/medical/medical.module';
import { AdminController } from './admin.controller';

/** 營運 / AI Review Console。不含派單與拆帳（SRS §5）。 */
@Module({
  imports: [ExtractModule, MedicalModule],
  controllers: [AdminController],
})
export class AdminModule {}
