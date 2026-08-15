import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type ActorRole = 'elder' | 'guardian' | 'admin' | 'system';

export interface Actor {
  role: ActorRole;
  /** elder.id / guardian.id / admin user id。 */
  id: string;
  lineUserId: string | null;
}

/**
 * 目前呼叫者。由 LineAuthGuard 解析後掛在 request 上。
 *
 * 交接規格 §3：LIFF 使用 LINE id_token 換發 JWT。
 * 授權相關端點必須用這個身分判斷，不得信任 request body 傳來的 elderId 當作身分。
 */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const request = ctx.switchToHttp().getRequest();
  return request.actor as Actor;
});
