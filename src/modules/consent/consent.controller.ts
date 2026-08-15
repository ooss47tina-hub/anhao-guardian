import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { Actor, CurrentActor } from 'src/common/auth/actor';
import { LineAuthGuard } from 'src/common/auth/line-auth.guard';
import { ConsentService } from 'src/common/consent/consent.service';
import { ConsentScope } from 'src/database/entities';

class ConsentDto {
  @IsIn(['core', 'medical', 'pattern_share', 'voice_retention', 'mood_share', 'raw_chat_share'])
  scope: ConsentScope;

  @IsBoolean()
  granted: boolean;

  /** LINE 訊息 id 或 LIFF 事件 id，作為同意證據。 */
  @IsString()
  @IsNotEmpty()
  evidenceRef: string;
}

/**
 * POST /v1/consent — 僅接受長者本人 LINE 身分；append-only（交接規格 §3）。
 *
 * 這裡不接受 elderId 參數：長者只能為自己授權，
 * 而長者身分來自 LINE id_token，不是 request body。
 * 守護者呼叫必定被 ConsentService 擋下並拋 ElderConsentRequiredError。
 */
@Controller('v1')
@UseGuards(LineAuthGuard)
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Post('consent')
  async submit(@CurrentActor() actor: Actor, @Body() dto: ConsentDto) {
    const input = {
      elderId: actor.id,
      scope: dto.scope,
      actorRole: actor.role,
      actorId: actor.id,
      evidenceRef: dto.evidenceRef,
    };

    if (dto.granted) {
      return this.consent.grant(input);
    }
    await this.consent.revoke(input);
    return { scope: dto.scope, granted: false };
  }

  /**
   * 目前授權狀態。
   * 守護者也能讀（G-05「我可以看到什麼」），但只能看，不能改。
   */
  @Get('elders/:elderId/consent')
  async current(@Param('elderId') elderId: string) {
    return {
      elderId,
      grantedScopes: await this.consent.grantedScopes(elderId),
      canUseService: await this.consent.canUseService(elderId),
    };
  }
}
