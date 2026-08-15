import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Elder, Guardian } from 'src/database/entities';
import { LINE_PORT, LinePort } from 'src/ports/line.port';
import { Actor } from './actor';

/**
 * LIFF id_token → 內部身分。
 *
 * 交接規格 §3：「LIFF 使用 LINE id_token 換發 JWT」。
 *
 * 目前直接以 id_token 換身分，尚未發 JWT。
 * TODO(auth)：正式環境改為換發短效 JWT，避免每次請求都打 LINE 驗證端點。
 * 換發後這個 guard 只需改 resolve 的來源，controller 不需動。
 *
 * 身分解析順序刻意是「長者優先」：同一個 LINE 帳號理論上不會既是長者又是守護者，
 * 但若資料異常，把人當成長者是較安全的一側 —— 長者身分能做的事範圍較窄，
 * 且守護者專屬端點會另外檢查 guardian_link。
 */
@Injectable()
export class LineAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(Elder) private readonly elders: Repository<Elder>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @Inject(LINE_PORT) private readonly line: LinePort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['authorization'] as string | undefined;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少 LINE id_token');
    }

    const { lineUserId } = await this.line.verifyIdToken(header.slice('Bearer '.length));

    const elder = await this.elders.findOne({ where: { lineUserId } });
    if (elder) {
      request.actor = { role: 'elder', id: elder.id, lineUserId } satisfies Actor;
      return true;
    }

    const guardian = await this.guardians.findOne({ where: { lineUserId } });
    if (guardian) {
      request.actor = { role: 'guardian', id: guardian.id, lineUserId } satisfies Actor;
      return true;
    }

    throw new UnauthorizedException('LINE 身分尚未綁定');
  }
}
