import { Module } from '@nestjs/common';
import { AdminAuthGuard } from 'src/common/auth/admin-auth.guard';
import { ExtractModule } from 'src/modules/extract/extract.module';
import { MedicalModule } from 'src/modules/medical/medical.module';
import { AdminConsoleController } from './admin-console.controller';
import { AdminController } from './admin.controller';

/** 營運 / AI Review Console。不含派單與拆帳（SRS §5）。 */
@Module({
  imports: [ExtractModule, MedicalModule],
  controllers: [AdminController, AdminConsoleController],
  providers: [AdminAuthGuard],
})
export class AdminModule {}
