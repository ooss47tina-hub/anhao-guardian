import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Actor, CurrentActor } from 'src/common/auth/actor';
import { LineAuthGuard } from 'src/common/auth/line-auth.guard';
import { STT_PORT, SttPort } from 'src/ports/stt.port';
import { ConfigService } from '@nestjs/config';
import { ConversationService } from 'src/modules/conversation/conversation.service';
import { MemoryService } from 'src/modules/memory/memory.service';
import { PersonaEditableField, PersonaService, PERSONA_TEMPLATES } from 'src/modules/persona/persona.service';
import { PrivacyService } from 'src/modules/privacy/privacy.service';
import { PublicHealthService } from 'src/modules/publicdata/public-health.service';
import { LinkService } from 'src/modules/identity/link.service';

class ChatTurnDto {
  utterance: string;
}

class PersonaPatchDto {
  changes: Partial<Record<PersonaEditableField, string>>;
}

class SttDto {
  audioRef: string;
  mimeType: string;
}

class InviteAcceptDto {
  code: string;
  relation: string;
}

class EraseConfirmDto {
  confirmationToken: string;
}

/**
 * 長者端與雙端共用的 API（交接規格 §3）。
 */
@Controller('v1')
@UseGuards(LineAuthGuard)
export class ElderController {
  constructor(
    private readonly conversation: ConversationService,
    private readonly memory: MemoryService,
    private readonly persona: PersonaService,
    private readonly privacy: PrivacyService,
    private readonly publicHealth: PublicHealthService,
    private readonly links: LinkService,
    private readonly config: ConfigService,
    @Inject(STT_PORT) private readonly stt: SttPort,
  ) {}

  /** POST /v1/chat/turn — 產生 AI 回話，同步觸發 extract。 */
  @Post('chat/turn')
  async chatTurn(@CurrentActor() actor: Actor, @Body() dto: ChatTurnDto) {
    this.assertElder(actor);
    // 自然語言風格調整（「講慢一點」）先攔一次，再走一般對話。
    await this.persona.applyAdaptiveStyle(actor.id, dto.utterance);
    return this.conversation.handleTurn({ elderId: actor.id, utterance: dto.utterance });
  }

  /**
   * POST /v1/stt — 回傳文字與信心值。
   * 低於 0.75 要求長者重說，不猜語意（交接規格 §3）。
   */
  @Post('stt')
  async transcribe(@CurrentActor() actor: Actor, @Body() dto: SttDto) {
    this.assertElder(actor);
    const result = await this.stt.transcribe({ ref: dto.audioRef, mimeType: dto.mimeType });
    const minConfidence = this.config.get<number>('rules.sttMinConfidence') ?? 0.75;

    return {
      text: result.confidence >= minConfidence ? result.text : null,
      confidence: result.confidence,
      needsRetry: result.confidence < minConfidence,
      prompt: result.confidence < minConfidence ? '我剛剛沒聽清楚，可以再說一次嗎？' : null,
    };
  }

  /** E-03 記憶確認卡：「對，記下來」／「不用了」。 */
  @Post('memories/:memoryId/confirm')
  async confirmMemory(@CurrentActor() actor: Actor, @Param('memoryId') memoryId: string) {
    this.assertElder(actor);
    return this.memory.confirm(memoryId, actor.id);
  }

  @Post('memories/:memoryId/reject')
  async rejectMemory(@CurrentActor() actor: Actor, @Param('memoryId') memoryId: string) {
    this.assertElder(actor);
    await this.memory.reject(memoryId, actor.id);
    return { rejected: true };
  }

  /** GET/PATCH /v1/elders/:id/persona — 兩端皆可；守護者可代設語氣。 */
  @Get('elders/:elderId/persona')
  async getPersona(@Param('elderId') elderId: string) {
    return {
      config: await this.persona.get(elderId),
      templates: PERSONA_TEMPLATES,
    };
  }

  @Patch('elders/:elderId/persona')
  async patchPersona(
    @CurrentActor() actor: Actor,
    @Param('elderId') elderId: string,
    @Body() dto: PersonaPatchDto,
  ) {
    return this.persona.upsert({
      elderId,
      actorRole: actor.role === 'guardian' ? 'guardian' : 'elder',
      actorId: actor.id,
      changes: dto.changes,
    });
  }

  @Post('elders/:elderId/persona/preview')
  async previewPersona(@Param('elderId') elderId: string) {
    return this.persona.preview(elderId);
  }

  @Get('elders/:elderId/persona/history')
  async personaHistory(@Param('elderId') elderId: string) {
    return this.persona.changeHistory(elderId);
  }

  /** POST /v1/links/invite ｜ /accept — M1 綁定。 */
  @Post('links/invite')
  async invite(@CurrentActor() actor: Actor) {
    return this.links.createInvite(
      actor.role === 'elder'
        ? { createdByRole: 'elder', elderId: actor.id }
        : { createdByRole: 'guardian', guardianId: actor.id },
    );
  }

  @Post('links/accept')
  async accept(@CurrentActor() actor: Actor, @Body() dto: InviteAcceptDto) {
    return this.links.accept({
      code: dto.code,
      relation: dto.relation,
      ...(actor.role === 'elder' ? { elderId: actor.id } : { guardianId: actor.id }),
    });
  }

  /** GET /v1/elders/:id/public-health — E-06：健檢資格、健檢數值、附近活動。 */
  @Get('elders/:elderId/public-health')
  async publicHealthView(@Param('elderId') elderId: string) {
    return this.publicHealth.view(elderId);
  }

  /** POST /v1/elders/:id/export — 資料可攜。僅長者本人。 */
  @Post('elders/:elderId/export')
  async exportData(@CurrentActor() actor: Actor, @Param('elderId') elderId: string) {
    return this.privacy.export({ elderId, actorRole: actor.role, actorId: actor.id });
  }

  /**
   * POST /v1/elders/:id/erase — 刪除為不可逆，需二次確認（交接規格 §3）。
   * 不帶 token 時回傳 token；帶 token 時才真的刪除。
   */
  @Post('elders/:elderId/erase')
  async erase(
    @CurrentActor() actor: Actor,
    @Param('elderId') elderId: string,
    @Body() dto: EraseConfirmDto,
  ) {
    const input = { elderId, actorRole: actor.role, actorId: actor.id };
    if (!dto?.confirmationToken) {
      return this.privacy.requestErase(input);
    }
    return this.privacy.confirmErase({ ...input, confirmationToken: dto.confirmationToken });
  }

  private assertElder(actor: Actor): void {
    if (actor.role !== 'elder') {
      throw new ForbiddenException('此端點僅供長者本人使用');
    }
  }
}
