import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';

/** AI Memory / Life Timeline。未經長者確認不得用於主動提醒（交接規格 §2.2）。 */
@Module({
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
