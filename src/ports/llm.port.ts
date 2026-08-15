import { SignalDimension } from 'src/domain/signal-dimension';

export const LLM_PORT = Symbol('LlmPort');

/** persona_config 的子集，用於組 prompt。不含任何家庭分享權限欄位。 */
export interface PersonaContext {
  personaName: string;
  templateKey: 'life_assistant' | 'companion' | 'concise' | 'family_bridge';
  elderSalutation: string;
  initiativeLevel: 'low' | 'medium' | 'high';
  reminderStyle: 'gentle' | 'direct';
}

export interface ChatTurnRequest {
  elderId: string;
  personaContext: PersonaContext;
  /** 已確認或高信心的記憶。SRS F1-02：AI 僅使用已確認或高信心資料回答。 */
  confirmedMemories: string[];
  recentTurns: Array<{ role: 'elder' | 'assistant'; text: string }>;
  utterance: string;
}

export interface ExtractedSignal {
  dimension: SignalDimension;
  value: string;
  confidence: number;
  /** 該訊號在原句中的依據，供人工抽查對照。 */
  evidence: string;
  occurredOn: string;
}

export interface MemoryCandidate {
  kind: 'preference' | 'relation' | 'routine' | 'place' | 'medical' | 'event';
  content: string;
  confidence: number;
  /** 高影響記憶（醫院、固定回診、緊急聯絡人）必須經長者確認。SRS F1-02。 */
  highImpact: boolean;
}

export interface ChatTurnResult {
  reply: string;
  extractedSignals: ExtractedSignal[];
  memoryCandidates: MemoryCandidate[];
  /** Safety Rule 由規則層判定，這裡只回報 LLM 觀察到的疑慮，不作為唯一依據。 */
  concernHints: string[];
  modelVersion: string;
  promptVersion: string;
}

export interface PatternExplanationRequest {
  deviations: Array<{ dimension: SignalDimension; recent: number; baseline: number }>;
  supportingQuotes: string[];
}

export interface LlmPort {
  /**
   * 產生 AI 回話並同步萃取訊號。
   * 對應 POST /v1/chat/turn（交接規格第 3 節）與 SRS F1-01。
   */
  chatTurn(request: ChatTurnRequest): Promise<ChatTurnResult>;

  /**
   * 產生給人看的變化說明。
   * 交接規格 2.3：explanation 需可由 supporting_signals 重建。
   * 輸出必經 DiagnosticLanguageFilter，不得含診斷式語言。
   */
  explainPattern(request: PatternExplanationRequest): Promise<string>;

  /** 產生週摘要本文。內容不含聊天原文（交接規格 2.3 weekly_digest）。 */
  composeDigest(input: {
    dimensionSummary: Array<{ dimension: SignalDimension; recent: number; baseline: number }>;
    upcomingTasks: string[];
    stable: boolean;
  }): Promise<{ headline: string; body: string }>;

  /** Persona Preview 文字（SRS F0-02）。 */
  personaPreview(persona: PersonaContext): Promise<string>;
}
