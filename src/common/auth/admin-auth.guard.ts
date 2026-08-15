import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Actor } from './actor';

export const ADMIN_COOKIE_NAME = 'anhao_admin';

/**
 * 營運方的固定身分。
 *
 * 目前是單一共用 token，沒有個別帳號 —— 所以 reviewer_id 需要一個穩定的 uuid。
 * signal_review.reviewer_id 與 medication_item.human_verified_by 都是無 FK 的
 * uuid 欄位，用固定值不會有參照完整性問題。
 * 需要分辨是哪位營運人員時應改接正式 IdP，不要自建使用者表。
 */
export const OPERATOR_ACTOR_ID = '00000000-0000-0000-0000-00000000ad11';

/** timing-safe 的 token 比對。長度不同直接不等 —— 長度本身會外洩，但遠比逐字元試探弱。 */
export function adminTokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 營運後台認證。
 *
 * 與 LineAuthGuard 的差異：這裡不解析任何外部身分，只比對共用 token。
 *
 * 兩個不可放寬的點：
 * 1. ADMIN_TOKEN 未設定時一律拒絕。未設定的環境變數不得等於「不用驗證」——
 *    /admin 必須在 production 可用，沒有第二道環境 gating 兜底。
 * 2. 比對用 timingSafeEqual。字串 === 的比較時間隨相同前綴長度變化，
 *    可被用來逐字元試出 token。
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('admin.token') ?? '';
    if (expected === '') {
      throw new UnauthorizedException('營運後台未設定 ADMIN_TOKEN');
    }

    const request = context.switchToHttp().getRequest();
    const presented = this.presentedToken(request.headers ?? {});

    if (presented === null || !adminTokenMatches(presented, expected)) {
      throw new UnauthorizedException('營運後台憑證無效');
    }

    request.actor = { role: 'admin', id: OPERATOR_ACTOR_ID, lineUserId: null } satisfies Actor;
    return true;
  }

  /** cookie 優先（瀏覽器），其次 Authorization（curl 與營運腳本）。 */
  private presentedToken(headers: Record<string, unknown>): string | null {
    const cookie = headers['cookie'];
    if (typeof cookie === 'string') {
      for (const part of cookie.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === ADMIN_COOKIE_NAME) {
          const raw = rest.join('=');
          try {
            return decodeURIComponent(raw);
          } catch {
            // 惡意或畸形的 cookie 值（如 "%"）解碼會丟 URIError，
            // 不能讓它變成未捕捉例外把 401 變成 500。
            // 直接視為原始（未解碼）字串繼續走比對，幾乎必定比對失敗，維持 fail-closed。
            return raw;
          }
        }
      }
    }

    const authorization = headers['authorization'];
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      return authorization.slice('Bearer '.length);
    }

    return null;
  }
}
