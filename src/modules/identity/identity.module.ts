import { Module } from '@nestjs/common';
import { LinkService } from './link.service';

/** M1 綁定。邀請碼一次性、24 小時失效（交接規格 §3）。 */
@Module({
  providers: [LinkService],
  exports: [LinkService],
})
export class IdentityModule {}
