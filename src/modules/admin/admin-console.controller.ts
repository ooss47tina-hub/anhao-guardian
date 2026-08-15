import { Body, Controller, Get, Header, Post, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsNotEmpty, IsString } from 'class-validator';
import type { Response } from 'express';
import { ADMIN_COOKIE_NAME, adminTokenMatches } from 'src/common/auth/admin-auth.guard';
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
    // 這是唯一免認證且收到原始 token 的端點，比對必須與 guard 共用同一個 timing-safe 函式，
    // 否則攻擊者可對這支端點打時間側錄，逐字元試出 token。
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
