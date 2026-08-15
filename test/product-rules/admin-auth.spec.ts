import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { AdminAuthGuard, ADMIN_COOKIE_NAME, OPERATOR_ACTOR_ID } from 'src/common/auth/admin-auth.guard';
import { AdminController } from 'src/modules/admin/admin.controller';
import { AdminConsoleController } from 'src/modules/admin/admin-console.controller';

/**
 * 交接規格 §3：/admin/* 為營運 Console。
 * 設計規格 §3：認證是唯一的門 —— /admin 必須在 production 可用，
 * 不像 /dev 有「production 不載入模組」當第二道保險。
 */
describe('產品原則：營運後台認證', () => {
  function contextWith(headers: Record<string, string>): ExecutionContext {
    const request = { headers, actor: undefined as unknown };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function guardWith(token: string): AdminAuthGuard {
    const config = { get: (key: string) => (key === 'admin.token' ? token : undefined) };
    return new AdminAuthGuard(config as never);
  }

  it('ADMIN_TOKEN 未設定時一律拒絕（fail closed）', () => {
    const guard = guardWith('');
    expect(() => guard.canActivate(contextWith({ authorization: 'Bearer anything' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('沒有帶 token 就拒絕', () => {
    const guard = guardWith('s3cret');
    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
  });

  it('token 錯誤就拒絕', () => {
    const guard = guardWith('s3cret');
    expect(() => guard.canActivate(contextWith({ authorization: 'Bearer wrong' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('cookie 帶對的 token 就放行，並掛上 admin 身分', () => {
    const guard = guardWith('s3cret');
    const context = contextWith({ cookie: `${ADMIN_COOKIE_NAME}=s3cret` });
    expect(guard.canActivate(context)).toBe(true);

    const request = context.switchToHttp().getRequest();
    expect(request.actor).toEqual({ role: 'admin', id: OPERATOR_ACTOR_ID, lineUserId: null });
  });

  it('Authorization header 帶對的 token 也放行（供 curl 與營運腳本）', () => {
    const guard = guardWith('s3cret');
    expect(guard.canActivate(contextWith({ authorization: 'Bearer s3cret' }))).toBe(true);
  });

  /**
   * 這條是關鍵：新增端點時若忘了掛 guard，其他測試都不會失敗。
   * 用反射列出 admin 前綴下的所有路由，未受保護的必須剛好等於允許清單。
   */
  it('admin 前綴下未受保護的路由剛好只有頁面與登入登出', () => {
    const allowed = ['GET /admin', 'POST /admin/login', 'POST /admin/logout'];
    const unprotected: string[] = [];

    for (const controller of [AdminController, AdminConsoleController]) {
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      const prefix = Reflect.getMetadata(PATH_METADATA, controller);
      const prototype = controller.prototype as unknown as Record<string, unknown>;

      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;

        const path = Reflect.getMetadata(PATH_METADATA, handler);
        if (path === undefined) continue;

        const methodGuards = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
        if (classGuards.length > 0 || methodGuards.length > 0) continue;

        const verb = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'][
          Reflect.getMetadata(METHOD_METADATA, handler)
        ];
        unprotected.push(`${verb} /${prefix}${path === '/' ? '' : `/${path}`}`);
      }
    }

    expect(unprotected.sort()).toEqual(allowed.sort());
  });
});
