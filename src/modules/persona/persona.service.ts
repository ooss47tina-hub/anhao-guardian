import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from 'src/common/audit/audit.service';
import { ElderConsentRequiredError } from 'src/common/errors/product-rule.errors';
import { PersonaConfig, PersonaConfigHistory, PersonaTemplate } from 'src/database/entities';
import { LLM_PORT, LlmPort, PersonaContext } from 'src/ports/llm.port';

/**
 * 語氣類欄位：守護者可代設（SRS 1.5「家人可協助」）。
 * 交接規格 §3：「守護者可代設語氣，不可代設分享範圍」。
 */
const GUARDIAN_EDITABLE_FIELDS = [
  'templateKey',
  'personaName',
  'elderSalutation',
  'voiceId',
  'avatarKey',
  'initiativeLevel',
  'reminderStyle',
  'speakingSpeed',
] as const;

export type PersonaEditableField = (typeof GUARDIAN_EDITABLE_FIELDS)[number];

/** MVP 僅提供 4 種 Template（SRS F0-01）。 */
export const PERSONA_TEMPLATES: Array<{ key: PersonaTemplate; name: string; desc: string }> = [
  { key: 'life_assistant', name: '生活管家型', desc: '幫你記事情、提醒行程' },
  { key: 'companion', name: '貼心陪伴型', desc: '陪你聊天，說話溫柔一點' },
  { key: 'concise', name: '簡潔助理型', desc: '講重點，不囉唆' },
  { key: 'family_bridge', name: '家庭連結型', desc: '幫你和家人保持聯繫' },
];

@Injectable()
export class PersonaService {
  constructor(
    @InjectRepository(PersonaConfig) private readonly configs: Repository<PersonaConfig>,
    @InjectRepository(PersonaConfigHistory) private readonly history: Repository<PersonaConfigHistory>,
    private readonly audit: AuditService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
  ) {}

  async get(elderId: string): Promise<PersonaConfig | null> {
    return this.configs.findOne({ where: { elderId } });
  }

  /**
   * 建立或更新 Persona。
   *
   * Template 只改變語氣、主動程度與回應長度，不改變資料權限、安全規則或
   * Pattern 判斷（SRS F0-01）—— 所以這裡碰不到任何 consent 或 rule 設定。
   */
  async upsert(input: {
    elderId: string;
    actorRole: 'elder' | 'guardian';
    actorId: string;
    changes: Partial<Record<PersonaEditableField, string>>;
    source?: 'manual' | 'adaptive';
  }): Promise<PersonaConfig> {
    const invalid = Object.keys(input.changes).filter(
      (key) => !GUARDIAN_EDITABLE_FIELDS.includes(key as PersonaEditableField),
    );
    if (invalid.length > 0) {
      // 分享範圍與身分相關欄位不在 Persona API 的可改範圍（交接規格 §3）。
      throw new ElderConsentRequiredError(`Persona 欄位 ${invalid.join('、')}`);
    }

    const existing = await this.configs.findOne({ where: { elderId: input.elderId } });
    const config =
      existing ??
      this.configs.create({
        elderId: input.elderId,
        templateKey: 'companion',
        personaName: '小安',
        elderSalutation: '您',
      });

    const mutable = config as unknown as Record<string, unknown>;

    for (const [field, value] of Object.entries(input.changes)) {
      const oldValue = mutable[field];
      if (String(oldValue ?? '') === String(value)) continue;

      mutable[field] = value;

      // 所有變更需留下紀錄，長者可還原（SRS F0-03）。
      await this.history.save(
        this.history.create({
          elderId: input.elderId,
          field,
          oldValue: oldValue == null ? null : String(oldValue),
          newValue: value == null ? null : String(value),
          source: input.source ?? 'manual',
          actorId: input.actorId,
        }),
      );
    }

    const saved = await this.configs.save(config);

    await this.audit.record({
      actorType: input.actorRole,
      actorId: input.actorId,
      action: 'persona.update',
      targetTable: 'persona_config',
      targetId: saved.id,
      after: input.changes as Record<string, unknown>,
    });

    return saved;
  }

  /** POST /elders/:id/persona/preview — 試聽（SRS F0-02）。 */
  async preview(elderId: string): Promise<{ text: string }> {
    const config = await this.get(elderId);
    const context: PersonaContext = config
      ? {
          personaName: config.personaName,
          templateKey: config.templateKey,
          elderSalutation: config.elderSalutation,
          initiativeLevel: config.initiativeLevel,
          reminderStyle: config.reminderStyle,
        }
      : {
          personaName: '小安',
          templateKey: 'companion',
          elderSalutation: '您',
          initiativeLevel: 'medium',
          reminderStyle: 'gentle',
        };
    return { text: await this.llm.personaPreview(context) };
  }

  /** GET /elders/:id/persona/history — 設定變更紀錄。 */
  async changeHistory(elderId: string): Promise<PersonaConfigHistory[]> {
    return this.history.find({ where: { elderId }, order: { changedAt: 'DESC' } });
  }

  /**
   * 自然語言風格調整（「講慢一點」「少講一點」「主動一點」）。
   * SRS F0-03：Adaptive Style 不得自行修改 Persona 身分、家庭分享權限、
   * 緊急聯絡人或醫療資料 —— 所以只映射到三個語氣欄位。
   */
  async applyAdaptiveStyle(elderId: string, utterance: string): Promise<PersonaConfig | null> {
    const changes: Partial<Record<PersonaEditableField, string>> = {};

    if (/講慢一點|說慢一點|太快/.test(utterance)) changes.speakingSpeed = 'slow';
    if (/少講一點|太多話|簡單一點/.test(utterance)) changes.templateKey = 'concise';
    if (/不要一直問|別一直問/.test(utterance)) changes.initiativeLevel = 'low';
    if (/多陪我|主動一點/.test(utterance)) changes.initiativeLevel = 'high';
    if (/直接一點/.test(utterance)) changes.reminderStyle = 'direct';

    if (Object.keys(changes).length === 0) return null;

    return this.upsert({
      elderId,
      actorRole: 'elder',
      actorId: elderId,
      changes,
      source: 'adaptive',
    });
  }
}
