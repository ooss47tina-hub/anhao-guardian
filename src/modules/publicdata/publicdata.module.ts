import { Module } from '@nestjs/common';
import { PublicHealthService } from './public-health.service';

/** 健康存摺、健檢資格、社區活動（交接規格 §5）。 */
@Module({
  providers: [PublicHealthService],
  exports: [PublicHealthService],
})
export class PublicDataModule {}
