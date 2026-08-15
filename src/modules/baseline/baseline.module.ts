import { Module } from '@nestjs/common';
import { BaselineService } from './baseline.service';

/** Individual Baseline。以個人為單位，不與其他長者比較（SRS §1.3）。 */
@Module({
  providers: [BaselineService],
  exports: [BaselineService],
})
export class BaselineModule {}
