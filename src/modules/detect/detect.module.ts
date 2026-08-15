import { Module } from '@nestjs/common';
import { BaselineModule } from 'src/modules/baseline/baseline.module';
import { PatternEngineService } from './pattern-engine.service';

/** Pattern Change Detection。分級由規則決定，LLM 只負責措辭（SRS F2-02）。 */
@Module({
  imports: [BaselineModule],
  providers: [PatternEngineService],
  exports: [PatternEngineService],
})
export class DetectModule {}
