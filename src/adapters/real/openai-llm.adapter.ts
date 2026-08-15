import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { VERSIONS } from 'src/common/versioning/versions';
import { DIMENSION_LABELS, SIGNAL_DIMENSIONS, SignalDimension } from 'src/domain/signal-dimension';
import {
  ChatTurnRequest,
  ChatTurnResult,
  ExtractedSignal,
  LlmPort,
  MemoryCandidate,
  PatternExplanationRequest,
  PersonaContext,
} from 'src/ports/llm.port';
import {
  buildChatSystemPrompt,
  buildPreviewPrompt,
  CHAT_TURN_SCHEMA,
  DIGEST_SCHEMA,
  DIGEST_SYSTEM_PROMPT,
  EXPLAIN_SYSTEM_PROMPT,
} from './openai-llm.prompts';

/**
 * OpenAI 正式串接。
 *
 * 設計要點：
 * - 用 structured outputs（json_schema + strict）而非「請回傳 JSON」的祈使句。
 *   訊號萃取是整個 Baseline 的資料來源，格式不能靠模型自律。
 * - 萃取結果一律再過一次本地驗證（validateSignals）。schema 保證了「形狀」，
 *   保證不了「內容合理」—— 未知維度、超出範圍的信心值、造假的 evidence 都要擋。
 * - 任何一次呼叫失敗都不吞掉。回話失敗長者會發現，但訊號萃取失敗是靜默的，
 *   Baseline 會慢慢失真而沒人知道。
 */
@Injectable()
export class OpenAiLlmAdapter implements LlmPort {
  private readonly logger = new Logger(OpenAiLlmAdapter.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('llm.apiKey') ?? '';
    if (!apiKey) {
      throw new Error('LLM_PROVIDER=openai 時必須設定 LLM_API_KEY');
    }

    this.model = config.get<string>('llm.model') || 'gpt-5.6-terra';
    this.client = new OpenAI({
      apiKey,
      baseURL: config.get<string>('llm.baseUrl') || undefined,
      maxRetries: 2,
    });
  }

  /**
   * POST /v1/chat/turn 的核心。
   *
   * 回話與訊號萃取合併成一次呼叫：長者等回話的時間就是萃取的時間，
   * 拆成兩次會讓長者多等一輪。
   */
  async chatTurn(request: ChatTurnRequest): Promise<ChatTurnResult> {
    const today = new Date().toISOString().slice(0, 10);
    const system = buildChatSystemPrompt(request.personaContext).replace('{{TODAY}}', today);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
    ];

    if (request.confirmedMemories.length > 0) {
      // 已確認的記憶當作背景資訊，不是指令 —— 避免模型硬把記憶塞進回話。
      messages.push({
        role: 'system',
        content: `你已知道關於${request.personaContext.elderSalutation}的事（只在自然的時候提起）：\n${request.confirmedMemories
          .map((m) => `- ${m}`)
          .join('\n')}`,
      });
    }

    for (const turn of request.recentTurns) {
      messages.push({
        role: turn.role === 'elder' ? 'user' : 'assistant',
        content: turn.text,
      });
    }
    messages.push({ role: 'user', content: request.utterance });

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'chat_turn', strict: true, schema: CHAT_TURN_SCHEMA },
      },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new Error('OpenAI 回傳空內容');
    }

    const parsed = JSON.parse(raw) as {
      reply: string;
      extractedSignals: ExtractedSignal[];
      memoryCandidates: MemoryCandidate[];
      concernHints: string[];
    };

    return {
      reply: parsed.reply.trim(),
      extractedSignals: this.validateSignals(parsed.extractedSignals ?? [], request.utterance),
      memoryCandidates: (parsed.memoryCandidates ?? []).filter(
        (m) => m.content?.trim() && m.confidence >= 0.5,
      ),
      concernHints: parsed.concernHints ?? [],
      modelVersion: `openai:${completion.model}`,
      promptVersion: VERSIONS.prompt,
    };
  }

  /**
   * 萃取結果的本地驗證。
   *
   * schema 保證欄位存在，保證不了內容可信。這裡擋掉四種會污染 Baseline 的情況：
   * 未知維度、信心值超出範圍、低信心（模型自己也不確定）、evidence 不在原句裡
   * （模型自己造的證據，代表這個訊號多半也是造的）。
   */
  private validateSignals(signals: ExtractedSignal[], utterance: string): ExtractedSignal[] {
    const valid: ExtractedSignal[] = [];

    for (const signal of signals) {
      if (!SIGNAL_DIMENSIONS.includes(signal.dimension)) {
        this.logger.warn(`丟棄未知維度的訊號：${signal.dimension}`);
        continue;
      }
      if (typeof signal.confidence !== 'number' || signal.confidence < 0 || signal.confidence > 1) {
        this.logger.warn(`丟棄信心值異常的訊號：${signal.dimension}=${signal.confidence}`);
        continue;
      }
      // 門檻與 prompt 裡告訴模型的一致。
      if (signal.confidence < 0.6) continue;

      // interaction 是「有講話」本身，evidence 不必逐字出現在句中。
      if (signal.dimension !== 'interaction' && signal.evidence) {
        const normalized = (s: string) => s.replace(/\s+/g, '');
        if (!normalized(utterance).includes(normalized(signal.evidence))) {
          this.logger.warn(`丟棄 evidence 不在原句中的訊號：「${signal.evidence}」`);
          continue;
        }
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(signal.occurredOn)) {
        signal.occurredOn = new Date().toISOString().slice(0, 10);
      }

      valid.push(signal);
    }

    // 長者有講話就是 interaction 訊號 —— Baseline 的互動維度靠這個，
    // 不能依賴模型每次都記得抽。
    if (!valid.some((s) => s.dimension === 'interaction')) {
      valid.push({
        dimension: 'interaction',
        value: 'checked_in',
        confidence: 0.99,
        evidence: utterance.slice(0, 20),
        occurredOn: new Date().toISOString().slice(0, 10),
      });
    }

    return valid;
  }

  /**
   * 給人看的變化說明。
   * 分級由 PatternEngineService 的規則決定，這裡只負責措辭（SRS F2-02）。
   * 輸出仍會被 DiagnosticLanguageFilter 檢查，這是第二道防線。
   */
  async explainPattern(request: PatternExplanationRequest): Promise<string> {
    const facts = request.deviations
      .map(
        (d) =>
          `${DIMENSION_LABELS[d.dimension]}：近 7 天 ${d.recent} 次，個人近 28 天平均每週 ${d.baseline} 次`,
      )
      .join('\n');

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: EXPLAIN_SYSTEM_PROMPT },
        { role: 'user', content: `統計數字：\n${facts}\n\n請寫成給家人看的說明。` },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI 回傳空的 pattern 說明');
    return text;
  }

  async composeDigest(input: {
    dimensionSummary: Array<{ dimension: SignalDimension; recent: number; baseline: number }>;
    upcomingTasks: string[];
    stable: boolean;
  }): Promise<{ headline: string; body: string }> {
    const summary = input.dimensionSummary
      .map((d) => `${DIMENSION_LABELS[d.dimension]}：本週 ${d.recent} 次，平常 ${d.baseline} 次`)
      .join('\n');

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: DIGEST_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            input.stable ? '本週狀態：與平常大致一致。' : '本週狀態：有維度低於平常。',
            `四維度數字：\n${summary}`,
            input.upcomingTasks.length
              ? `需要家人知道的事：\n${input.upcomingTasks.join('\n')}`
              : '本週沒有需要家人處理的事。',
          ].join('\n\n'),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'weekly_digest', strict: true, schema: DIGEST_SCHEMA },
      },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('OpenAI 回傳空的週摘要');
    return JSON.parse(raw) as { headline: string; body: string };
  }

  async personaPreview(persona: PersonaContext): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'system', content: buildPreviewPrompt(persona) }],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI 回傳空的 Persona preview');
    return text;
  }
}
