import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from 'src/common/audit/audit.service';
import { DiagnosticLanguageFilter } from 'src/common/safety/diagnostic-language.filter';
import { SafetyHit, SafetyRuleService } from 'src/common/safety/safety-rule.service';
import { PersonaConfig } from 'src/database/entities';
import { LLM_PORT, LlmPort, PersonaContext } from 'src/ports/llm.port';
import { SignalExtractionService } from 'src/modules/extract/signal-extraction.service';
import { MemoryService } from 'src/modules/memory/memory.service';
import { NotificationService } from 'src/modules/notify/notification.service';
import { MessageRepository } from './message.repository';

export interface ChatTurnResponse {
  reply: string;
  /** 命中的安全規則。非空代表已即時通知守護者並進人工佇列。 */
  safetyHits: SafetyHit[];
  signalCount: number;
  memoryCandidateIds: string[];
}

/**
 * POST /v1/chat/turn — 產生 AI 回話，同步觸發 extract（交接規格 §3）。
 *
 * 順序很重要：安全規則先於一切。
 * 交接規格 §4：「高風險語句命中不等 Pattern，立即通知並進人工佇列。」
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectRepository(PersonaConfig) private readonly personas: Repository<PersonaConfig>,
    private readonly messages: MessageRepository,
    private readonly extraction: SignalExtractionService,
    private readonly memory: MemoryService,
    private readonly safety: SafetyRuleService,
    private readonly diagnosticFilter: DiagnosticLanguageFilter,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
  ) {}

  async handleTurn(input: { elderId: string; utterance: string }): Promise<ChatTurnResponse> {
    const inbound = await this.messages.append({
      elderId: input.elderId,
      direction: 'inbound',
      modality: 'text',
      text: input.utterance,
    });

    // ── 安全規則優先。不等 Pattern Engine、不受安靜時段限制。 ──
    const safetyHits = this.safety.evaluate(input.utterance);
    if (safetyHits.length > 0) {
      await this.handleSafetyHits(input.elderId, safetyHits);
    }

    const persona = await this.personaContext(input.elderId);
    const memories = await this.memory.forConversation(input.elderId);
    const recentTurns = await this.messages.recentTurns(input.elderId, 6);

    const result = await this.llm.chatTurn({
      elderId: input.elderId,
      personaContext: persona,
      confirmedMemories: memories.map((m) => m.content),
      recentTurns: recentTurns
        .filter((m) => m.text)
        .map((m) => ({
          role: m.direction === 'inbound' ? ('elder' as const) : ('assistant' as const),
          text: m.text as string,
        })),
      utterance: input.utterance,
    });

    // 高風險時以安全規則的回應為準，不讓 LLM 自由發揮。
    const reply = safetyHits.length > 0 ? this.composeSafetyReply(persona, safetyHits) : result.reply;

    // 系統不輸出診斷、不評估傷勢（交接規格 §6）。
    this.diagnosticFilter.assertClean(reply);

    await this.messages.append({
      elderId: input.elderId,
      direction: 'outbound',
      modality: 'text',
      text: reply,
    });

    const signals = await this.extraction.persist({
      elderId: input.elderId,
      messageId: inbound.id,
      signals: result.extractedSignals,
    });

    const memoryItems = await this.memory.proposeMany({
      elderId: input.elderId,
      sourceMessageId: inbound.id,
      candidates: result.memoryCandidates,
    });

    return {
      reply,
      safetyHits,
      signalCount: signals.length,
      memoryCandidateIds: memoryItems.map((m) => m.id),
    };
  }

  private async handleSafetyHits(elderId: string, hits: SafetyHit[]): Promise<void> {
    const categories = hits.map((h) => h.category).join('、');

    await this.notifications.dispatchSafetyAlert({
      elderId,
      headline: `${categories}：長者剛剛提到需要留意的狀況，請盡快聯絡。`,
    });

    // 事件記入 audit log，並進 Admin 人工佇列（介面原型 Flow D）。
    await this.audit.record({
      actorType: 'system',
      action: 'safety_rule.hit',
      targetTable: 'elder',
      targetId: elderId,
      after: { categories: hits.map((h) => h.category), keywords: hits.map((h) => h.matchedKeyword) },
    });

    this.logger.warn(`長者 ${elderId} 命中安全規則：${categories}`);
  }

  /**
   * 高風險回應。
   * 只提示尋求真人／醫療協助，不評估傷勢、不下判斷（SRS Flow D）。
   */
  private composeSafetyReply(persona: PersonaContext, hits: SafetyHit[]): string {
    return `${persona.elderSalutation}，${hits[0].responseHint}我已經跟家人說了。`;
  }

  private async personaContext(elderId: string): Promise<PersonaContext> {
    const config = await this.personas.findOne({ where: { elderId } });
    if (!config) {
      // Persona 尚未設定時的安全預設。E-00 精靈完成前不應走到這裡。
      return {
        personaName: '小安',
        templateKey: 'companion',
        elderSalutation: '您',
        initiativeLevel: 'medium',
        reminderStyle: 'gentle',
      };
    }
    return {
      personaName: config.personaName,
      templateKey: config.templateKey,
      elderSalutation: config.elderSalutation,
      initiativeLevel: config.initiativeLevel,
      reminderStyle: config.reminderStyle,
    };
  }
}
