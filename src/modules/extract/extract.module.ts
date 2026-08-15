import { Module } from '@nestjs/common';
import { SignalExtractionService } from './signal-extraction.service';

/** Life Signal 落地與低信心人工抽查佇列（交接規格 §1 Extract）。 */
@Module({
  providers: [SignalExtractionService],
  exports: [SignalExtractionService],
})
export class ExtractModule {}
