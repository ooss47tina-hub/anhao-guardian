import { Module } from '@nestjs/common';
import { ConsentController } from './consent.controller';

/** 用途分層同意。ConsentService 由 CoreModule 全域提供。 */
@Module({
  controllers: [ConsentController],
})
export class ConsentModule {}
