import { Injectable } from '@nestjs/common';
import { VERSIONS } from 'src/common/versioning/versions';
import { DIMENSION_LABELS, SignalDimension } from 'src/domain/signal-dimension';
import {
  ChatTurnRequest,
  ChatTurnResult,
  ExtractedSignal,
  LlmPort,
  MemoryCandidate,
  PatternExplanationRequest,
  PersonaContext,
} from 'src/ports/llm.port';

/**
 * 規則式假 LLM。
 *
 * 目的不是模擬 LLM 品質，而是讓整條資料流在沒有金鑰的情況下可跑、可測、可重現。
 * 抽取邏輯刻意用關鍵字比對而非隨機，因此測試斷言是穩定的。
 *
 * 正式環境請用 src/adapters/real/openai-llm.adapter.ts（待實作），
 * 並以 test/fixtures/signal-corpus.json 的語料跑 Precision ≥ 85% 驗收（SRS 第 11 節）。
 */

interface Matcher {
  dimension: SignalDimension;
  keywords: string[];
  value: string;
  confidence: number;
}

/** 正向訊號比對表。命中即產生 signal。 */
const MATCHERS: Matcher[] = [
  { dimension: 'outing', keywords: ['去市場', '出門', '散步', '公園', '買菜'], value: 'went_out', confidence: 0.91 },
  { dimension: 'meal', keywords: ['吃飯', '早餐', '午餐', '晚餐', '煮'], value: 'ate', confidence: 0.86 },
  { dimension: 'meal', keywords: ['沒胃口', '吃不下'], value: 'poor_appetite', confidence: 0.82 },
  { dimension: 'sleep_subjective', keywords: ['睡不好', '睡不太好', '睡不著', '沒睡好', '失眠', '很累'], value: 'poor_sleep', confidence: 0.88 },
  { dimension: 'social', keywords: ['朋友', '鄰居', '秀琴', '聊天', '一起'], value: 'met_someone', confidence: 0.84 },
  { dimension: 'mood', keywords: ['開心', '高興', '不錯'], value: 'positive', confidence: 0.79 },
  { dimension: 'mood', keywords: ['煩', '難過', '無聊'], value: 'negative', confidence: 0.78 },
  { dimension: 'concern', keywords: ['擔心', '怕'], value: 'worried', confidence: 0.75 },
  { dimension: 'task', keywords: ['要去', '約了', '回診', '看醫生'], value: 'upcoming_task', confidence: 0.87 },
];

/**
 * 否定與第三人稱前綴。
 * SRS 第 11 節：「不得把否定、他人事件誤寫為本人訊號」。
 * 這是假實作也必須守的規則 —— 否則測試會給出假的安全感。
 */
const NEGATION_MARKERS = ['沒有', '不想', '沒去', '沒能', '還沒'];
const THIRD_PARTY_MARKERS = ['我朋友', '隔壁', '我女兒', '他', '她說'];

const TEMPLATE_TONE: Record<PersonaContext['templateKey'], string> = {
  life_assistant: '我幫你記著了。',
  companion: '聽你這樣說我也放心一些。',
  concise: '好。',
  family_bridge: '我會挑重點讓家人知道。',
};

@Injectable()
export class FakeLlmAdapter implements LlmPort {
  async chatTurn(request: ChatTurnRequest): Promise<ChatTurnResult> {
    const utterance = request.utterance;
    const signals = this.extract(utterance, request);
    const memoryCandidates = this.proposeMemories(utterance);

    return {
      reply: this.compose(request, signals),
      extractedSignals: signals,
      memoryCandidates,
      concernHints: signals.filter((s) => s.dimension === 'concern').map((s) => s.evidence),
      modelVersion: VERSIONS.model,
      promptVersion: VERSIONS.prompt,
    };
  }

  private extract(utterance: string, request: ChatTurnRequest): ExtractedSignal[] {
    const occurredOn = new Date().toISOString().slice(0, 10);
    const isThirdParty = THIRD_PARTY_MARKERS.some((m) => utterance.includes(m));
    if (isThirdParty) return [];

    const signals: ExtractedSignal[] = [];
    for (const matcher of MATCHERS) {
      const hit = matcher.keywords.find((k) => utterance.includes(k));
      if (!hit) continue;

      const negated = NEGATION_MARKERS.some((n) => {
        const at = utterance.indexOf(hit);
        return utterance.slice(Math.max(0, at - 4), at).includes(n);
      });
      if (negated) continue;

      signals.push({
        dimension: matcher.dimension,
        value: matcher.value,
        confidence: matcher.confidence,
        evidence: hit,
        occurredOn,
      });
    }

    // 長者有講話本身就是 interaction 訊號 —— Baseline 的互動維度靠這個。
    signals.push({
      dimension: 'interaction',
      value: 'checked_in',
      confidence: 0.99,
      evidence: request.utterance.slice(0, 20),
      occurredOn,
    });

    return signals;
  }

  private proposeMemories(utterance: string): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    if (/醫師|醫院|回診|骨科|門診/.test(utterance)) {
      candidates.push({
        kind: 'medical',
        content: utterance.slice(0, 40),
        confidence: 0.83,
        highImpact: true,
      });
    }
    if (/每週|每天|固定/.test(utterance)) {
      candidates.push({ kind: 'routine', content: utterance.slice(0, 40), confidence: 0.8, highImpact: false });
    }
    return candidates;
  }

  private compose(request: ChatTurnRequest, signals: ExtractedSignal[]): string {
    const { elderSalutation, templateKey } = request.personaContext;
    const mentioned = signals
      .filter((s) => s.dimension !== 'interaction')
      .map((s) => DIMENSION_LABELS[s.dimension]);
    const tail = mentioned.length ? `你提到${mentioned.join('、')}的事，` : '';
    return `${elderSalutation}，${tail}${TEMPLATE_TONE[templateKey]}`;
  }

  async explainPattern(request: PatternExplanationRequest): Promise<string> {
    const parts = request.deviations.map(
      (d) =>
        `近 7 天${DIMENSION_LABELS[d.dimension]}訊號 ${d.recent} 次；個人近 28 天平均每週 ${d.baseline} 次`,
    );
    return `${parts.join('。')}。兩個維度以上持續偏離。`;
  }

  async composeDigest(input: {
    dimensionSummary: Array<{ dimension: SignalDimension; recent: number; baseline: number }>;
    upcomingTasks: string[];
    stable: boolean;
  }): Promise<{ headline: string; body: string }> {
    if (input.stable) {
      // SRS F3-02：全週穩定時摘要應極短。
      return {
        headline: '本週生活型態與平常大致一致',
        body: '無需特別處理。',
      };
    }
    const changed = input.dimensionSummary
      .filter((d) => d.recent < d.baseline)
      .map((d) => DIMENSION_LABELS[d.dimension]);
    return {
      headline: `本週${changed.join('、')}比平常少`,
      body: `${changed.join('、')}的訊號低於個人平常水準。${input.upcomingTasks.join('；')}`,
    };
  }

  async personaPreview(persona: PersonaContext): Promise<string> {
    return `${persona.elderSalutation}，我是${persona.personaName}。${TEMPLATE_TONE[persona.templateKey]}`;
  }
}
