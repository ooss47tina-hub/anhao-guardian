import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['authorization'] as string | undefined;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少 LINE id_token');
    }

    const raw = header.slice('Bearer '.length);

    /**
     * 開發用直通 token。
     *
     * 接上真 LINE 之後，LinePort.verifyIdToken 會真的去打 LINE 的驗證端點，
     * 於是 /dev 檢視頁與守護者端網頁用的示範 token 全部失效 —— 但那兩個
     * 介面正是用來驗收的。這裡在非 production 環境放行 "id-token:<lineUserId>"
     * 格式，讓開發工具在真串接下仍能運作。
     *
     * production 一律不放行，且格式刻意與真 id_token（JWT，含兩個點）不同，
     * 不可能誤判。
     */
    const isDevToken = raw.startsWith('id-token:');
    if (isDevToken && this.config.get<string>('env') === 'production') {
      throw new UnauthorizedException('開發用 token 不可用於正式環境');
    }

    const { lineUserId } = isDevToken
      ? { lineUserId: raw.slice('id-token:'.length) }
      : await this.line.verifyIdToken(raw);

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
