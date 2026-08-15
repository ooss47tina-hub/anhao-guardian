# 營運 / Review Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 `/admin/*` 加上認證，並提供一個後端直出的營運後台頁面，讓營運方看得到長者總覽、訊號抽查、藥品覆核與系統狀態。

**Architecture:** 拆成兩個 controller —— `AdminController`（所有資料端點，類別層掛 `AdminAuthGuard`）與 `AdminConsoleController`（頁面與登入，刻意不掛 guard）。認證用單一 `ADMIN_TOKEN` 比對，通過後發 httpOnly cookie。畫面沿用 `/dev` 的做法：controller 回傳 HTML 常數字串，頁面再打 JSON 端點取資料。

**Tech Stack:** NestJS 11、TypeORM 0.3、Jest 29 + supertest 7。不新增任何 npm 依賴。

## Global Constraints

- 對應規格：`docs/superpowers/specs/2026-08-15-admin-console-design.md`
- `/admin` **必須在 production 可用** —— 不可沿用 `/dev` 的 `assertDev()` 或 `app.module.ts` 的環境 gating。認證是唯一的門。
- **Fail closed**：`ADMIN_TOKEN` 未設定或為空字串時，一律拒絕所有請求。未設定的環境變數不得等於「不用驗證」。
- Token 比對用 `crypto.timingSafeEqual`，不可用 `===`。
- 營運後台**不得提供 `message.text` 的讀取路徑**。可讀 `life_signal.evidence`（規格定義的抽查片段），不可讀完整對話原文。
- `reviewerId` 一律取自登入身分，不得由 request body 傳入。
- 品質頁面不顯示聊天次數與 Dashboard 瀏覽量（交接規格 §6）。
- 所有 DTO 欄位必須有 class-validator 裝飾器 —— `main.ts` 的 `ValidationPipe({ whitelist: true })` 會把沒有裝飾器的欄位整個剝掉，body 變空且不報錯。
- 註解與 UI 文字用繁體中文，與既有程式一致。
- 每個 task 結束時 `npm test` 與 `npm run typecheck` 都必須全綠。

---

### Task 1: AdminAuthGuard 與 controller 拆分

**Files:**
- Create: `src/common/auth/admin-auth.guard.ts`
- Create: `src/modules/admin/admin-console.controller.ts`
- Modify: `src/common/config/configuration.ts`（新增 `admin` 區塊）
- Modify: `src/modules/admin/admin.controller.ts`（掛 guard）
- Modify: `src/modules/admin/admin.module.ts`（註冊新 controller 與 guard）
- Test: `test/product-rules/admin-auth.spec.ts`

**Interfaces:**
- Consumes: 既有 `Actor` 型別（`src/common/auth/actor.ts`）、`ConfigService`
- Produces:
  - `AdminAuthGuard`（class，`implements CanActivate`）
  - `OPERATOR_ACTOR_ID: string`（常數，值為 `'00000000-0000-0000-0000-00000000ad11'`）
  - `ADMIN_COOKIE_NAME: string`（常數，值為 `'anhao_admin'`）
  - config 路徑 `admin.token: string`
  - `AdminConsoleController` 提供 `GET /admin`、`POST /admin/login`、`POST /admin/logout`

**背景：為什麼拆兩個 controller**

登入端點與頁面本身不能要求 token（雞生蛋問題）。常見做法是加 `@Public()` 裝飾器讓 guard 跳過，但那等於在 guard 上開一個「可以被標記為不檢查」的口子 —— 將來有人為新端點加上 `@Public()` 就沒有任何機制會發現。改成兩個 controller：一個全部要驗、一個全部不驗且只放不含資料的路由。哪個端點在哪一邊，看 import 就知道。

- [ ] **Step 1: 新增設定**

修改 `src/common/config/configuration.ts`，在 `crypto` 區塊之後插入：

```ts
  /**
   * 營運後台。
   * 未設定時 AdminAuthGuard 一律拒絕 —— 空字串不等於「不用驗證」。
   * 單一共用 token；需要多帳號時應改接正式 IdP，不要自建使用者表。
   */
  admin: {
    token: process.env.ADMIN_TOKEN ?? '',
  },
```

- [ ] **Step 2: 寫失敗的測試**

建立 `test/product-rules/admin-auth.spec.ts`：

```ts
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

  it('同長度的錯誤 token 也拒絕（驗證內容比對真的有跑，不只長度短路）', () => {
    const guard = guardWith('s3cret');
    expect(() => guard.canActivate(contextWith({ authorization: 'Bearer s3creX' }))).toThrow(
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
      const prototype = controller.prototype as Record<string, unknown>;

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
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `npx jest test/product-rules/admin-auth.spec.ts`
Expected: FAIL —— `Cannot find module 'src/common/auth/admin-auth.guard'`

- [ ] **Step 4: 實作 guard**

建立 `src/common/auth/admin-auth.guard.ts`：

```ts
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

    if (presented === null || !this.matches(presented, expected)) {
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
        if (name === ADMIN_COOKIE_NAME) return decodeURIComponent(rest.join('='));
      }
    }

    const authorization = headers['authorization'];
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      return authorization.slice('Bearer '.length);
    }

    return null;
  }

  private matches(presented: string, expected: string): boolean {
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    // timingSafeEqual 長度不同會直接拋錯，先擋掉。
    // 長度本身會外洩，但那遠比逐字元試探弱。
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
```

- [ ] **Step 5: 建立 console controller**

建立 `src/modules/admin/admin-console.controller.ts`：

```ts
import { Body, Controller, Get, Header, Post, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsNotEmpty, IsString } from 'class-validator';
import type { Response } from 'express';
import { ADMIN_COOKIE_NAME } from 'src/common/auth/admin-auth.guard';
import { ADMIN_CONSOLE_HTML } from './admin-console.html';

class LoginDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

/**
 * 頁面與登入。刻意不掛 AdminAuthGuard —— 登入端點若要求 token 就是雞生蛋。
 *
 * 這個 controller 只能放「不回傳任何長者資料」的路由。
 * 需要資料的端點一律放 AdminController（類別層有 guard）。
 * test/product-rules/admin-auth.spec.ts 用允許清單釘住這條界線。
 */
@Controller('admin')
export class AdminConsoleController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return ADMIN_CONSOLE_HTML;
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): { ok: true } {
    const expected = this.config.get<string>('admin.token') ?? '';
    // 這是唯一免認證且收到原始 token 的端點 —— 比對必須 timing-safe，
    // 與 AdminAuthGuard 共用同一個比對函式。
    if (expected === '' || !adminTokenMatches(dto.token, expected)) {
      throw new UnauthorizedException('憑證無效');
    }

    res.cookie(ADMIN_COOKIE_NAME, dto.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<string>('env') === 'production',
      maxAge: 12 * 60 * 60 * 1000,
    });
    return { ok: true };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(ADMIN_COOKIE_NAME);
    return { ok: true };
  }
}
```

- [ ] **Step 6: 建立畫面的佔位常數**

Task 6 才寫真正的畫面。先建立 `src/modules/admin/admin-console.html.ts` 讓編譯過得去：

```ts
/** 營運後台頁面。內容於 Task 6 完成。 */
export const ADMIN_CONSOLE_HTML = /* html */ `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>安好 · 營運後台</title></head>
<body><p>建置中</p></body>
</html>`;
```

- [ ] **Step 7: 在 AdminController 掛上 guard**

修改 `src/modules/admin/admin.controller.ts`。把 import 那行改成：

```ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
```

新增 import：

```ts
import { AdminAuthGuard } from 'src/common/auth/admin-auth.guard';
```

把 `@Controller('admin')` 上方的 `TODO(auth)` 註解整段刪掉（那個 TODO 就是這個 task 在解），並改成：

```ts
/**
 * 營運 / AI Review Console（交接規格 §3、SRS 第 5 節）。
 * 不含派單與拆帳。
 *
 * guard 掛在類別層而非逐個端點 —— 少掛一個端點不會有任何錯誤訊息，
 * 只會安靜地開一個洞。頁面與登入放在 AdminConsoleController。
 */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
```

- [ ] **Step 8: 註冊到模組**

修改 `src/modules/admin/admin.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { AdminAuthGuard } from 'src/common/auth/admin-auth.guard';
import { ExtractModule } from 'src/modules/extract/extract.module';
import { MedicalModule } from 'src/modules/medical/medical.module';
import { AdminConsoleController } from './admin-console.controller';
import { AdminController } from './admin.controller';

/** 營運 / AI Review Console。不含派單與拆帳（SRS §5）。 */
@Module({
  imports: [ExtractModule, MedicalModule],
  controllers: [AdminController, AdminConsoleController],
  providers: [AdminAuthGuard],
})
export class AdminModule {}
```

- [ ] **Step 9: 執行測試確認通過**

Run: `npx jest test/product-rules/admin-auth.spec.ts`
Expected: PASS（6 個測試）

- [ ] **Step 10: 全套測試與型別檢查**

Run: `npm test && npm run typecheck`
Expected: 全部通過。`test/di-graph.spec.ts` 已含 `AdminModule`，會自動涵蓋新的 controller 與 provider —— 若這支失敗代表 DI 接線有問題。

- [ ] **Step 11: 補上 .env 範例**

`.env` 與 `.env.example` 都存在，兩個檔案末端都要加：

```
# 營運後台。未設定時 /admin/* 一律拒絕。
ADMIN_TOKEN=dev-admin-token
```

`.env.example` 是進版控的範本，漏加會讓下一個人接手時 `/admin` 直接全部 401 而不知原因。

- [ ] **Step 12: Commit**

```bash
# .env 是 gitignored 且含真實金鑰，只改不 commit；進版控的是 .env.example。
git add src/common/auth/admin-auth.guard.ts src/common/config/configuration.ts src/modules/admin/ test/product-rules/admin-auth.spec.ts .env.example
git commit -m "feat(admin): /admin/* 加上認證

AdminAuthGuard 比對單一 ADMIN_TOKEN，通過後發 httpOnly cookie。
ADMIN_TOKEN 未設定時 fail closed —— /admin 必須在 production 可用，
沒有 /dev 那種環境 gating 當第二道保險。

頁面與登入拆到 AdminConsoleController（不掛 guard），資料端點全在
AdminController（類別層掛 guard）。測試用反射列出 admin 前綴下所有路由，
未受保護的必須剛好等於允許清單 —— 新增端點忘了掛 guard 會被擋下來。"
```

---

### Task 2: reviewerId 改由登入身分取

**Files:**
- Modify: `src/modules/admin/admin.controller.ts`
- Test: `test/product-rules/admin-auth.spec.ts`（新增 describe 區塊）

**Interfaces:**
- Consumes: Task 1 的 `AdminAuthGuard`（會在 request 上掛 `Actor`）、既有 `CurrentActor` 裝飾器
- Produces: `ReviewDto` 與 `VerifyMedicationDto` 不再含 `reviewerId` 欄位

**背景**

`ReviewDto.reviewerId` 與 `VerifyMedicationDto.reviewerId` 目前由呼叫端從 body 傳入。任何人都可以宣稱自己是任何審查員，而這個值會寫進 `signal_review.reviewer_id`、`medication_item.human_verified_by` 與 `audit_log.actor_id`。稽核紀錄若可由呼叫端自行宣稱，等於沒有稽核。

- [ ] **Step 1: 寫失敗的測試**

在 `test/product-rules/admin-auth.spec.ts` 末端、最外層 `describe` 的閉合括號**之前**加入：

```ts
  describe('審查者身分不可由呼叫端宣稱', () => {
    it('reviewerId 取自登入身分，body 帶的值無效', async () => {
      const extraction = { review: jest.fn(async () => ({ id: 'review-1' })) };
      const medication = { verify: jest.fn(async () => ({ id: 'item-1' })) };
      const notifications = { count: jest.fn(async () => 0) };
      const config = { get: jest.fn(() => 0.7) };

      const controller = new AdminController(
        extraction as never,
        medication as never,
        notifications as never,
        config as never,
      );

      const actor = { role: 'admin' as const, id: OPERATOR_ACTOR_ID, lineUserId: null };

      await controller.review(actor, 'signal-1', {
        verdict: 'correct',
        // 刻意多塞一個欄位，模擬呼叫端試圖冒名。
        reviewerId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      } as never);

      expect(extraction.review).toHaveBeenCalledWith(
        expect.objectContaining({ reviewerId: OPERATOR_ACTOR_ID }),
      );

      await controller.verifyMedication(actor, 'item-1', {
        drugName: '降血壓藥',
        dosage: '每日一次',
        reviewerId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      } as never);

      expect(medication.verify).toHaveBeenCalledWith(
        expect.objectContaining({ reviewerId: OPERATOR_ACTOR_ID }),
      );
    });
  });
```

同時把檔案頂端的 import 補上 `Actor` 需要的型別來源（`AdminController` 已在 Task 1 匯入）。

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx jest test/product-rules/admin-auth.spec.ts -t "reviewerId"`
Expected: FAIL —— `review` 收到的 `reviewerId` 是 body 傳入的 `ffffffff-...`，不是 `OPERATOR_ACTOR_ID`

- [ ] **Step 3: 改 DTO 與 handler**

修改 `src/modules/admin/admin.controller.ts`。

把 `ReviewDto` 改成（移除 `reviewerId`）：

```ts
class ReviewDto {
  @IsIn(['correct', 'corrected', 'discarded'])
  verdict: ReviewVerdict;

  @IsOptional()
  @IsString()
  correctedValue?: string;
}
```

把 `VerifyMedicationDto` 改成（移除 `reviewerId`）：

```ts
class VerifyMedicationDto {
  @IsString()
  @IsNotEmpty()
  drugName: string;

  @IsString()
  @IsNotEmpty()
  dosage: string;
}
```

`IsUUID` 已無人使用，從 class-validator 的 import 移除。新增 `Actor` / `CurrentActor` 的 import：

```ts
import { Actor, CurrentActor } from 'src/common/auth/actor';
```

把兩個 handler 改成：

```ts
  /**
   * POST /admin/review/:signalId — 正確／修正，寫 signal_review 與 audit_log。
   *
   * reviewerId 取自登入身分，不接受 body 傳入 ——
   * 可由呼叫端宣稱的稽核紀錄等於沒有稽核。
   */
  @Post('review/:signalId')
  async review(
    @CurrentActor() actor: Actor,
    @Param('signalId') signalId: string,
    @Body() dto: ReviewDto,
  ) {
    return this.extraction.review({
      signalId,
      reviewerId: actor.id,
      verdict: dto.verdict,
      correctedValue: dto.correctedValue,
    });
  }

  /** 藥品人工確認佇列 —— 未確認前不得建立用藥提醒（交接規格 §6）。 */
  @Post('medications/:itemId/verify')
  async verifyMedication(
    @CurrentActor() actor: Actor,
    @Param('itemId') itemId: string,
    @Body() dto: VerifyMedicationDto,
  ) {
    return this.medication.verify({
      itemId,
      reviewerId: actor.id,
      drugName: dto.drugName,
      dosage: dto.dosage,
    });
  }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx jest test/product-rules/admin-auth.spec.ts`
Expected: PASS（7 個測試）

- [ ] **Step 5: 全套測試與型別檢查**

Run: `npm test && npm run typecheck`
Expected: 全部通過

- [ ] **Step 6: Commit**

```bash
git add src/modules/admin/admin.controller.ts test/product-rules/admin-auth.spec.ts
git commit -m "fix(admin): reviewerId 改由登入身分取，不再信任 request body

原本 ReviewDto 與 VerifyMedicationDto 的 reviewerId 由呼叫端傳入，
任何人都能宣稱自己是任何審查員，而該值會寫進 signal_review、
medication_item.human_verified_by 與 audit_log.actor_id。"
```

---

### Task 3: GET /admin/elders 長者總覽

**Files:**
- Create: `src/modules/admin/admin-overview.service.ts`
- Modify: `src/modules/admin/admin.controller.ts`
- Modify: `src/modules/admin/admin.module.ts`
- Test: `test/product-rules/admin-overview.spec.ts`

**Interfaces:**
- Consumes: 既有 `BaselineService.gate(elderId, asOf)` → `{ canDetect, effectiveDays, requiredDays }`；entities `Elder`、`Message`、`LifeSignal`、`GuardianLink`
- Produces:
  - `AdminOverviewService.listElders(): Promise<ElderOverviewRow[]>`
  - `interface ElderOverviewRow { elderId: string; displayName: string; status: string; messageCount: number; signalCount: number; effectiveDays: number; requiredDays: number; canDetect: boolean; guardianCount: number; lastInteractionAt: string | null }`

**背景**

系統目前沒有「列出所有長者」的 API，營運方唯一的辦法是直接下 SQL。

這個端點回傳的是**數量與狀態**，不含任何 `message.text`。`ElderOverviewRow` 刻意沒有可以放對話內容的欄位 —— 界線寫在型別上，而不是靠實作者記得。

- [ ] **Step 1: 寫失敗的測試**

建立 `test/product-rules/admin-overview.spec.ts`：

```ts
import { AdminOverviewService } from 'src/modules/admin/admin-overview.service';

/**
 * 設計規格 §2.1：營運層看得到 life_signal.evidence，看不到完整對話原文。
 * 交接規格 §6：「無原始數據牆」。
 */
describe('產品原則：長者總覽不含對話原文', () => {
  function buildService() {
    const elders = {
      find: jest.fn(async () => [
        {
          id: 'elder-1',
          displayName: '陳美玲',
          status: 'active',
          lineUserId: 'U-dev-elder-meiling',
        },
      ]),
    };
    const messages = {
      count: jest.fn(async () => 23),
      findOne: jest.fn(async () => ({ createdAt: new Date('2026-08-14T02:00:00Z') })),
    };
    const signals = { count: jest.fn(async () => 79) };
    const links = { count: jest.fn(async () => 1) };
    const baseline = {
      gate: jest.fn(async () => ({ canDetect: true, effectiveDays: 24, requiredDays: 21 })),
    };

    return {
      service: new AdminOverviewService(
        elders as never,
        messages as never,
        signals as never,
        links as never,
        baseline as never,
      ),
      messages,
    };
  }

  it('回傳數量與狀態，不含任何訊息內容欄位', async () => {
    const { service } = buildService();
    const rows = await service.listElders();

    expect(rows).toEqual([
      {
        elderId: 'elder-1',
        displayName: '陳美玲',
        status: 'active',
        messageCount: 23,
        signalCount: 79,
        effectiveDays: 24,
        requiredDays: 21,
        canDetect: true,
        guardianCount: 1,
        lastInteractionAt: '2026-08-14T02:00:00.000Z',
      },
    ]);
  });

  it('序列化後不出現任何訊息內容欄位', async () => {
    const { service } = buildService();
    const json = JSON.stringify(await service.listElders());

    for (const forbidden of ['text', 'textEncrypted', 'utterance', 'evidence']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('只用 count 取訊息數，不取出訊息本身', async () => {
    const { service, messages } = buildService();
    await service.listElders();

    // find/findBy 會把整列（含 text_encrypted）撈進記憶體。
    expect((messages as unknown as { find?: unknown }).find).toBeUndefined();
    expect(messages.count).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx jest test/product-rules/admin-overview.spec.ts`
Expected: FAIL —— `Cannot find module 'src/modules/admin/admin-overview.service'`

- [ ] **Step 3: 實作 service**

建立 `src/modules/admin/admin-overview.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Elder, GuardianLink, LifeSignal, Message } from 'src/database/entities';
import { BaselineService } from 'src/modules/baseline/baseline.service';

/**
 * 長者總覽的一列。
 *
 * 刻意沒有可以放對話內容的欄位 —— 設計規格 §2.1 的界線寫在型別上，
 * 不是靠實作者記得。要加欄位前先確認它不是聊天原文。
 */
export interface ElderOverviewRow {
  elderId: string;
  displayName: string;
  status: string;
  messageCount: number;
  signalCount: number;
  effectiveDays: number;
  requiredDays: number;
  canDetect: boolean;
  guardianCount: number;
  lastInteractionAt: string | null;
}

/** GET /admin/elders 的資料來源。 */
@Injectable()
export class AdminOverviewService {
  constructor(
    @InjectRepository(Elder) private readonly elders: Repository<Elder>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(LifeSignal) private readonly signals: Repository<LifeSignal>,
    @InjectRepository(GuardianLink) private readonly links: Repository<GuardianLink>,
    private readonly baseline: BaselineService,
  ) {}

  async listElders(): Promise<ElderOverviewRow[]> {
    const elders = await this.elders.find({ order: { createdAt: 'ASC' } });
    const asOf = new Date();

    return Promise.all(
      elders.map(async (elder): Promise<ElderOverviewRow> => {
        // 一律用 count —— find 會把整列（含 text_encrypted）撈進記憶體。
        const [messageCount, signalCount, guardianCount, gate, latest] = await Promise.all([
          this.messages.count({ where: { elderId: elder.id } }),
          this.signals.count({ where: { elderId: elder.id } }),
          this.links.count({ where: { elderId: elder.id, revokedAt: IsNull() } }),
          this.baseline.gate(elder.id, asOf),
          this.messages.findOne({
            where: { elderId: elder.id },
            order: { createdAt: 'DESC' },
            select: { createdAt: true },
          }),
        ]);

        return {
          elderId: elder.id,
          displayName: elder.displayName,
          status: elder.status,
          messageCount,
          signalCount,
          effectiveDays: gate.effectiveDays,
          requiredDays: gate.requiredDays,
          canDetect: gate.canDetect,
          guardianCount,
          lastInteractionAt: latest?.createdAt?.toISOString() ?? null,
        };
      }),
    );
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx jest test/product-rules/admin-overview.spec.ts`
Expected: PASS（3 個測試）

- [ ] **Step 5: 接上端點**

修改 `src/modules/admin/admin.controller.ts`。新增 import：

```ts
import { AdminOverviewService } from './admin-overview.service';
```

在 constructor 參數最前面加入：

```ts
    private readonly overview: AdminOverviewService,
```

在 `queue()` 方法之前加入端點：

```ts
  /**
   * GET /admin/elders — 長者總覽。
   * 只回數量與狀態，不提供任何 message.text 的讀取路徑（設計規格 §2.1）。
   */
  @Get('elders')
  async elders() {
    return { elders: await this.overview.listElders() };
  }
```

- [ ] **Step 6: 註冊到模組**

修改 `src/modules/admin/admin.module.ts`：把 `BaselineModule` 加入 imports、`AdminOverviewService` 加入 providers。

**不需要 `TypeOrmModule.forFeature`** —— `CoreModule` 是 `@Global()` 且已匯出
`TypeOrmModule.forFeature(ALL_ENTITIES)`，所有 entity 的 repository 全域可注入。
領域模組各自宣告 entity 反而會偏離既有做法。

```ts
import { Module } from '@nestjs/common';
import { AdminAuthGuard } from 'src/common/auth/admin-auth.guard';
import { BaselineModule } from 'src/modules/baseline/baseline.module';
import { ExtractModule } from 'src/modules/extract/extract.module';
import { MedicalModule } from 'src/modules/medical/medical.module';
import { AdminConsoleController } from './admin-console.controller';
import { AdminController } from './admin.controller';
import { AdminOverviewService } from './admin-overview.service';

/** 營運 / AI Review Console。不含派單與拆帳（SRS §5）。 */
@Module({
  imports: [ExtractModule, MedicalModule, BaselineModule],
  controllers: [AdminController, AdminConsoleController],
  providers: [AdminAuthGuard, AdminOverviewService],
})
export class AdminModule {}
```

`BaselineModule` 已有 `exports: [BaselineService]`，不需修改。

- [ ] **Step 7: 全套測試與型別檢查**

Run: `npm test && npm run typecheck`
Expected: 全部通過。`test/di-graph.spec.ts` 會驗證新的依賴接得起來。

- [ ] **Step 8: Commit**

```bash
git add src/modules/admin/ test/product-rules/admin-overview.spec.ts
git commit -m "feat(admin): GET /admin/elders 長者總覽

回傳長者狀態、訊息數、訊號數、Baseline 進度、綁定守護者數與最後互動時間。

ElderOverviewRow 刻意沒有可以放對話內容的欄位 —— 設計規格 §2.1 的界線
寫在型別上而不是靠實作者記得。訊息數一律用 count，不用 find（會把
text_encrypted 整列撈進記憶體）。"
```

---

### Task 4: GET /admin/medications/pending 待覆核藥品

**Files:**
- Modify: `src/modules/medical/medication.service.ts`
- Modify: `src/modules/admin/admin.controller.ts`
- Test: `test/product-rules/medication-human-review.spec.ts`（新增測試到既有檔案）

**Interfaces:**
- Consumes: 既有 `MedicationItem` entity
- Produces: `MedicationService.pendingItems(): Promise<MedicationItem[]>`

**背景**

交接規格 §6：「藥名與劑量未經人工確認不可建立用藥提醒。」`MedicationService` 目前只有 `pendingCount(elderId)`，沒有列出項目的方法 —— 沒有清單，人工確認這一關實務上做不到。

- [ ] **Step 1: 寫失敗的測試**

在 `test/product-rules/medication-human-review.spec.ts` 末端、最外層 `describe` 的閉合括號**之前**加入：

```ts
  it('待覆核清單只回未確認的項目，最舊的排前面', async () => {
    const rows = [
      { id: 'item-1', humanVerifiedBy: null, createdAt: new Date('2026-08-01') },
      { id: 'item-2', humanVerifiedBy: 'reviewer-1', createdAt: new Date('2026-08-02') },
    ];
    const items = {
      find: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        expect(where).toHaveProperty('humanVerifiedBy');
        return rows.filter((r) => r.humanVerifiedBy === null);
      }),
    };
    // MedicationService constructor：items, notifications, audit, ocr（共 4 個）
    const service = new MedicationService(
      items as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const pending = await service.pendingItems();

    expect(pending.map((i) => i.id)).toEqual(['item-1']);
    expect(items.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { createdAt: 'ASC' } }),
    );
  });
```

若該檔案已有共用的建構工廠函式，改用它而不要重寫這段建構程式碼。

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx jest test/product-rules/medication-human-review.spec.ts -t "待覆核清單"`
Expected: FAIL —— `service.pendingItems is not a function`

- [ ] **Step 3: 實作**

修改 `src/modules/medical/medication.service.ts`，在 `pendingCount` 之後加入：

```ts
  /**
   * 待人工確認的項目清單，供營運後台覆核。
   *
   * 最舊的排前面 —— 這是佇列不是列表，先進來的先處理。
   * 同樣用 IsNull()：TypeORM 會把 undefined 當作「不加條件」，
   * 結果會回傳全部項目而不是待確認的。
   */
  async pendingItems(): Promise<MedicationItem[]> {
    return this.items.find({
      where: { humanVerifiedBy: IsNull() },
      order: { createdAt: 'ASC' },
    });
  }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx jest test/product-rules/medication-human-review.spec.ts`
Expected: PASS

- [ ] **Step 5: 接上端點**

修改 `src/modules/admin/admin.controller.ts`，在 `verifyMedication` 方法**之前**加入：

```ts
  /**
   * GET /admin/medications/pending — 待人工確認的藥品項目。
   * 沒有這個清單，交接規格 §6 的人工確認關卡實務上做不到。
   */
  @Get('medications/pending')
  async pendingMedications() {
    return { items: await this.medication.pendingItems() };
  }
```

注意路由順序：`medications/pending` 必須宣告在任何 `medications/:param` 之前，否則 `pending` 會被當成參數值。目前只有 `medications/:itemId/verify`（多一段路徑不會衝突），但保持這個順序較安全。

- [ ] **Step 6: 全套測試與型別檢查**

Run: `npm test && npm run typecheck`
Expected: 全部通過

- [ ] **Step 7: Commit**

```bash
git add src/modules/medical/medication.service.ts src/modules/admin/admin.controller.ts test/product-rules/medication-human-review.spec.ts
git commit -m "feat(admin): GET /admin/medications/pending 待覆核藥品清單

MedicationService 原本只有 pendingCount，沒有列出項目的方法。
沒有清單，交接規格 §6 的藥名劑量人工確認關卡實務上做不到。"
```

---

### Task 5: 讀取 evidence 寫入 audit_log

**Files:**
- Modify: `src/modules/admin/admin.controller.ts`
- Modify: `src/modules/admin/admin.module.ts`（如需）
- Test: `test/product-rules/admin-auth.spec.ts`（新增 describe 區塊）

**Interfaces:**
- Consumes: 既有 `AuditService.record(entry: AuditEntry): Promise<void>`；Task 1 的 `Actor`
- Produces: 無新介面

**背景**

設計規格 §3.3：最高權限看得比守護者多，就要留得比守護者多。`GET /admin/review/queue` 回傳的訊號含 `evidence`（長者原句片段），這是營運層唯一能看到長者話語的地方，讀取必須留痕。

`AuditService` 由 `CoreModule` 提供，而 `CoreModule` 是 `@Global()` 且有 export ——
直接注入即可，`AdminModule` 不需要新增任何 import。

- [ ] **Step 1: 寫失敗的測試**

在 `test/product-rules/admin-auth.spec.ts` 末端、最外層 `describe` 的閉合括號**之前**加入：

```ts
  describe('讀取 evidence 要留痕', () => {
    it('讀抽查佇列會寫入 audit_log', async () => {
      const extraction = {
        reviewQueue: jest.fn(async () => [
          { id: 'signal-1', elderId: 'elder-1', evidence: '早上去市場' },
          { id: 'signal-2', elderId: 'elder-2', evidence: '睡不太好' },
        ]),
      };
      const audit = { record: jest.fn() };
      const config = { get: jest.fn(() => 0.7) };

      const controller = new AdminController(
        {} as never,
        extraction as never,
        {} as never,
        {} as never,
        config as never,
        audit as never,
      );

      const actor = { role: 'admin' as const, id: OPERATOR_ACTOR_ID, lineUserId: null };
      await controller.queue(actor, undefined);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'admin',
          actorId: OPERATOR_ACTOR_ID,
          action: 'admin.review_queue.read',
          targetTable: 'life_signal',
        }),
      );

      // 稽核紀錄本身不得複製 evidence 進去 —— 那會讓原句多存一份。
      expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain('早上去市場');
    });
  });
```

Task 3 之後 `AdminController` 的 constructor 順序是
`overview, extraction, medication, notifications, config`，本 task 在末端加上 `audit`，
所以是 6 個參數 —— 上面測試傳的順序即為最終順序。

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx jest test/product-rules/admin-auth.spec.ts -t "留痕"`
Expected: FAIL —— `audit.record` 未被呼叫

- [ ] **Step 3: 實作**

修改 `src/modules/admin/admin.controller.ts`。新增 import：

```ts
import { AuditService } from 'src/common/audit/audit.service';
```

在 constructor 參數末端加入：

```ts
    private readonly audit: AuditService,
```

把 `queue()` 改成：

```ts
  /**
   * GET /admin/review/queue — 低信心訊號抽查佇列。
   *
   * 回傳內容含 evidence（長者原句片段），是營運層唯一看得到長者話語的地方。
   * 讀取寫入 audit_log（設計規格 §3.3）—— 看得比守護者多，就要留得比守護者多。
   *
   * 稽核紀錄只留訊號與長者 id，不複製 evidence 本身：
   * 把原句再存一份到 audit_log 等於多開一個未加密的落地點。
   */
  @Get('review/queue')
  async queue(@CurrentActor() actor: Actor, @Query('limit') limit?: string) {
    const signals = await this.extraction.reviewQueue(limit ? Number.parseInt(limit, 10) : 50);

    await this.audit.record({
      actorType: 'admin',
      actorId: actor.id,
      action: 'admin.review_queue.read',
      targetTable: 'life_signal',
      targetId: null,
      after: {
        signalIds: signals.map((s) => s.id),
        elderIds: [...new Set(signals.map((s) => s.elderId))],
        count: signals.length,
      },
    });

    return {
      threshold: this.config.get<number>('rules.signalReviewConfidenceThreshold'),
      count: signals.length,
      signals,
    };
  }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx jest test/product-rules/admin-auth.spec.ts`
Expected: PASS

- [ ] **Step 5: 全套測試與型別檢查**

Run: `npm test && npm run typecheck`
Expected: 全部通過。若 `di-graph.spec.ts` 報 `AuditService` 找不到，在 `AdminModule` 的 imports 加入提供 `AuditService` 的模組（參考 `PersonaModule` 的做法）。

- [ ] **Step 6: Commit**

```bash
git add src/modules/admin/ test/product-rules/admin-auth.spec.ts
git commit -m "feat(admin): 讀取抽查佇列寫入 audit_log

evidence 是營運層唯一看得到長者話語的地方，讀取必須留痕（設計規格 §3.3）。
稽核紀錄只留 signal id 與 elder id，不複製 evidence 本身 ——
把原句再存一份到 audit_log 等於多開一個未加密的落地點。"
```

---

### Task 6: 後台畫面

**Files:**
- Modify: `src/modules/admin/admin-console.html.ts`（取代 Task 1 的佔位內容）

**Interfaces:**
- Consumes: `GET /admin/elders`、`GET /admin/review/queue`、`POST /admin/review/:signalId`、`GET /admin/medications/pending`、`POST /admin/medications/:itemId/verify`、`GET /admin/quality`、`GET /admin/integrations`、`POST /admin/login`
- Produces: `ADMIN_CONSOLE_HTML: string`

**背景**

沿用 `/dev` 的做法：單檔、無外部依賴、無建置步驟。cookie 是 httpOnly，所以頁面的 JS 不需要碰 token —— 登入後瀏覽器自動帶。

配色沿用 `/dev` 的深綠 `#2E6152` / 米白 `#F3EEE6`。

- [ ] **Step 1: 寫畫面**

把 `src/modules/admin/admin-console.html.ts` 整個檔案取代為：

```ts
/**
 * 營運後台頁面。單檔、無外部依賴，直接由 AdminConsoleController 回傳。
 *
 * cookie 是 httpOnly —— 頁面的 JS 不碰 token，登入後瀏覽器自動帶。
 * 任何 API 回 401 就跳回登入畫面。
 *
 * 這是內部工具，不求漂亮。將來要升級成獨立前端專案時 API 都在，換皮即可。
 */
export const ADMIN_CONSOLE_HTML = /* html */ `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>安好 · 營運後台</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang TC", "Noto Sans TC", sans-serif;
         background: #F3EEE6; color: #2b2b2b; padding: 24px; }
  h1 { font-size: 20px; color: #2E6152; margin-bottom: 16px; }
  .tabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .tabs button { border: none; background: #fff; padding: 8px 16px; border-radius: 999px;
                 cursor: pointer; font-size: 14px; color: #555; }
  .tabs button.on { background: #2E6152; color: #fff; }
  .card { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 16px;
          box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee;
           white-space: nowrap; }
  th { color: #777; font-weight: 600; font-size: 12px; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; }
  .ok { background: #E3EFE9; color: #2E6152; }
  .warn { background: #FBEEDD; color: #A96A1C; }
  .muted { background: #EEE; color: #777; }
  input { padding: 8px 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
  .act { border: none; background: #2E6152; color: #fff; padding: 6px 12px;
         border-radius: 8px; cursor: pointer; font-size: 12px; margin-right: 4px; }
  .act.ghost { background: #ddd; color: #333; }
  #login { max-width: 320px; }
  #toast { position: fixed; right: 20px; bottom: 20px; background: #2E6152; color: #fff;
           padding: 10px 16px; border-radius: 8px; display: none; font-size: 13px; }
</style>
</head>
<body>
<h1>安好 AI 自主生活守護 · 營運後台</h1>

<div class="card" id="login">
  <p style="margin-bottom:10px;font-size:14px;">請輸入營運 token</p>
  <input id="token" type="password" placeholder="ADMIN_TOKEN" style="width:100%">
  <button class="act" style="margin-top:10px" onclick="login()">登入</button>
</div>

<div id="app" style="display:none">
  <div class="tabs">
    <button data-tab="elders" class="on" onclick="show('elders')">長者總覽</button>
    <button data-tab="review" onclick="show('review')">訊號抽查</button>
    <button data-tab="meds" onclick="show('meds')">藥品覆核</button>
    <button data-tab="system" onclick="show('system')">系統狀態</button>
  </div>
  <div class="card" id="panel">載入中…</div>
</div>

<div id="toast"></div>

<script>
let tab = 'elders';

async function api(path, options) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    document.getElementById('app').style.display = 'none';
    document.getElementById('login').style.display = '';
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function login() {
  const token = document.getElementById('token').value;
  const res = await fetch('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ token }),
  });
  if (!res.ok) { toast('憑證無效'); return; }
  document.getElementById('login').style.display = 'none';
  document.getElementById('app').style.display = '';
  show(tab);
}

function show(next) {
  tab = next;
  for (const b of document.querySelectorAll('.tabs button')) {
    b.classList.toggle('on', b.dataset.tab === next);
  }
  ({ elders: renderElders, review: renderReview, meds: renderMeds, system: renderSystem })[next]();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function panel(html) { document.getElementById('panel').innerHTML = html; }

async function renderElders() {
  const { elders } = await api('/admin/elders');
  panel('<table><tr><th>長者</th><th>狀態</th><th>訊息</th><th>訊號</th>' +
    '<th>Baseline</th><th>守護者</th><th>最後互動</th></tr>' +
    elders.map((e) => {
      const base = e.canDetect
        ? '<span class="pill ok">可判斷 ' + e.effectiveDays + ' 天</span>'
        : '<span class="pill muted">' + e.effectiveDays + '/' + e.requiredDays + ' 天</span>';
      const guard = e.guardianCount > 0
        ? e.guardianCount
        : '<span class="pill warn">未綁定</span>';
      return '<tr><td>' + esc(e.displayName) + '</td><td>' + esc(e.status) + '</td><td>' +
        e.messageCount + '</td><td>' + e.signalCount + '</td><td>' + base + '</td><td>' +
        guard + '</td><td>' + (e.lastInteractionAt ? e.lastInteractionAt.slice(0, 16).replace('T', ' ') : '—') +
        '</td></tr>';
    }).join('') + '</table>');
}

async function renderReview() {
  const data = await api('/admin/review/queue');
  if (data.count === 0) { panel('<p style="font-size:14px">沒有待抽查的訊號。</p>'); return; }
  panel('<p style="font-size:12px;color:#777;margin-bottom:10px">信心值低於 ' +
    data.threshold + ' 的訊號，共 ' + data.count + ' 筆</p>' +
    '<table><tr><th>維度</th><th>值</th><th>信心</th><th>原句依據</th><th>發生日</th><th></th></tr>' +
    data.signals.map((s) =>
      '<tr><td>' + esc(s.dimension) + '</td><td>' + esc(s.value) + '</td><td>' +
      Number(s.confidence).toFixed(2) + '</td><td style="white-space:normal">' +
      esc(s.evidence) + '</td><td>' + esc(s.occurredOn) + '</td><td>' +
      '<button class="act" onclick="review(\\'' + s.id + '\\',\\'correct\\')">正確</button>' +
      '<button class="act ghost" onclick="review(\\'' + s.id + '\\',\\'discarded\\')">捨棄</button>' +
      '</td></tr>').join('') + '</table>');
}

async function review(signalId, verdict) {
  await api('/admin/review/' + signalId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verdict }),
  });
  toast(verdict === 'correct' ? '已標記正確' : '已捨棄');
  renderReview();
}

async function renderMeds() {
  const { items } = await api('/admin/medications/pending');
  if (items.length === 0) { panel('<p style="font-size:14px">沒有待覆核的藥品項目。</p>'); return; }
  panel('<p style="font-size:12px;color:#777;margin-bottom:10px">' +
    '藥名與劑量未經人工確認不可建立用藥提醒（交接規格 §6）</p>' +
    '<table><tr><th>OCR 原文</th><th>藥名</th><th>劑量</th><th></th></tr>' +
    items.map((i) =>
      '<tr><td style="white-space:normal">' + esc(i.ocrRaw) + '</td>' +
      '<td><input id="d-' + i.id + '" value="' + esc(i.drugName) + '" style="width:140px"></td>' +
      '<td><input id="s-' + i.id + '" value="' + esc(i.dosage) + '" style="width:140px"></td>' +
      '<td><button class="act" onclick="verify(\\'' + i.id + '\\')">確認</button></td></tr>',
    ).join('') + '</table>');
}

async function verify(itemId) {
  await api('/admin/medications/' + itemId + '/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      drugName: document.getElementById('d-' + itemId).value,
      dosage: document.getElementById('s-' + itemId).value,
    }),
  });
  toast('已確認');
  renderMeds();
}

async function renderSystem() {
  const [quality, integrations] = await Promise.all([
    api('/admin/quality'),
    api('/admin/integrations'),
  ]);
  const p = quality.signalPrecision;
  panel('<table><tr><th>指標</th><th>值</th></tr>' +
    '<tr><td>Signal Precision</td><td>' +
    // signalPrecision() 在沒有任何抽查紀錄時回傳 precision: 0，不是 null。
    // 直接顯示 0.000 會被誤讀成「抽查結果全錯」，所以看 reviewed 判斷。
    (p.reviewed === 0
      ? '尚無抽查資料'
      : Number(p.precision).toFixed(3) + '（' + p.correct + '/' + p.reviewed + '）') +
    '，目標 ' + p.target + '</td></tr>' +
    '<tr><td>通知已送出</td><td>' + quality.notifications.sent + '</td></tr>' +
    '<tr><td>通知被抑制</td><td>' + quality.notifications.suppressed + '</td></tr>' +
    '</table><p style="font-size:12px;color:#777;margin:10px 0">' + esc(quality.note) + '</p>' +
    '<table style="margin-top:14px"><tr><th>外部來源</th><th>主管機關</th><th>串接</th><th>方式</th></tr>' +
    integrations.sources.map((s) =>
      '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.agency) + '</td><td>' +
      (s.provider === 'real'
        ? '<span class="pill ok">真串接</span>'
        : '<span class="pill muted">fake</span>') +
      '</td><td>' + esc(s.method) + '</td></tr>').join('') + '</table>' +
    '<p style="font-size:12px;color:#777;margin-top:10px">規則 ' + esc(integrations.versions.rule) +
    ' · 模型 ' + esc(integrations.versions.model) +
    ' · prompt ' + esc(integrations.versions.prompt) + '</p>');
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// 已登入（cookie 還在）就直接進畫面。
api('/admin/elders').then(() => {
  document.getElementById('login').style.display = 'none';
  document.getElementById('app').style.display = '';
  show('elders');
}).catch(() => {});
</script>
</body>
</html>\`;
```

注意：檔案是 TypeScript 樣板字串，內層的反引號與 `${` 必須跳脫。上面的 HTML 沒有用到 `${`，字串內的單引號跳脫已寫成 `\\'`。

- [ ] **Step 2: 型別檢查與測試**

Run: `npm run typecheck && npm test`
Expected: 全部通過

- [ ] **Step 3: 實機驗證**

確認後端在跑（`npm run start:dev`），然後：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin
```

Expected: `200`

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin/elders
```

Expected: `401`

```bash
curl -s -H "Authorization: Bearer dev-admin-token" http://localhost:3000/admin/elders | head -c 400
```

Expected: JSON，含 `elders` 陣列與陳美玲等長者，且**不含任何對話內容**

用瀏覽器開 <http://localhost:3000/admin>，輸入 `dev-admin-token` 登入，四個分頁都要能載入。

- [ ] **Step 4: Commit**

```bash
git add src/modules/admin/admin-console.html.ts
git commit -m "feat(admin): 營運後台畫面

四個分頁：長者總覽、訊號抽查、藥品覆核、系統狀態。
單檔 HTML、無外部依賴、無建置步驟，沿用 /dev 的做法。
cookie 是 httpOnly，頁面 JS 不碰 token；任何 API 回 401 就跳回登入畫面。"
```

---

## 完成後

- [ ] 更新 `docs/CURRENT-STATE.md`：把「`/admin/*` 無認證」從「正式部署前必補」清單移除，並在「三個可以看的畫面」表格加入營運後台（<http://localhost:3000/admin>）
- [ ] 更新 `docs/HANDOFF.md`：同步移除 `/admin/*` 無認證的技術債條目
- [ ] Commit 文件更新
