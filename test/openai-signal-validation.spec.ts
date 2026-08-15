import { ConfigService } from '@nestjs/config';
import { OpenAiLlmAdapter } from 'src/adapters/real/openai-llm.adapter';
import { ExtractedSignal } from 'src/ports/llm.port';

/**
 * LLM 萃取結果的本地驗證。
 *
 * prompt 會告訴模型規則，但 prompt 不是保證。Baseline 完全建立在這些訊號上，
 * 一個錯訊號會讓家人收到錯的「跟平常不一樣」判斷 —— 所以模型輸出必須再驗一次。
 *
 * 這組測試不呼叫 OpenAI，只測驗證邏輯本身。
 */
describe('OpenAI 訊號驗證', () => {
  function adapter(): OpenAiLlmAdapter {
    const values: Record<string, string> = { 'llm.apiKey': 'sk-test', 'llm.model': 'gpt-4o' };
    return new OpenAiLlmAdapter({ get: (k: string) => values[k] } as ConfigService);
  }

  /** validateSignals 是 private —— 測試對外行為，經由型別斷言取得。 */
  function validate(signals: Partial<ExtractedSignal>[], utterance: string): ExtractedSignal[] {
    const instance = adapter() as unknown as {
      validateSignals(s: ExtractedSignal[], u: string): ExtractedSignal[];
    };
    return instance.validateSignals(signals as ExtractedSignal[], utterance);
  }

  const today = new Date().toISOString().slice(0, 10);
  const base = { confidence: 0.9, occurredOn: today };

  it('保留合法訊號', () => {
    const result = validate(
      [{ ...base, dimension: 'outing', value: 'went_out', evidence: '去菜市場' }],
      '我今天早上去菜市場',
    );
    expect(result.map((s) => s.dimension)).toContain('outing');
  });

  it('丟棄未知維度', () => {
    const result = validate(
      [{ ...base, dimension: 'exercise' as never, value: 'walked', evidence: '走路' }],
      '今天走路半小時',
    );
    expect(result.filter((s) => s.dimension !== 'interaction')).toHaveLength(0);
  });

  it('丟棄信心值超出 0–1 的訊號', () => {
    const result = validate(
      [{ ...base, confidence: 1.5, dimension: 'meal', value: 'ate', evidence: '吃飯' }],
      '剛吃飯',
    );
    expect(result.map((s) => s.dimension)).not.toContain('meal');
  });

  it('丟棄低信心訊號（模型自己也不確定）', () => {
    const result = validate(
      [{ ...base, confidence: 0.4, dimension: 'social', value: 'met_someone', evidence: '朋友' }],
      '想到朋友',
    );
    expect(result.map((s) => s.dimension)).not.toContain('social');
  });

  /**
   * 最重要的一條：模型自己造 evidence 時，那個訊號多半也是造的。
   */
  it('丟棄 evidence 不在原句中的訊號', () => {
    const result = validate(
      [{ ...base, dimension: 'outing', value: 'went_out', evidence: '去公園散步' }],
      '今天在家看電視',
    );
    expect(result.map((s) => s.dimension)).not.toContain('outing');
  });

  it('evidence 比對忽略空白差異', () => {
    const result = validate(
      [{ ...base, dimension: 'outing', value: 'went_out', evidence: '去 菜市場' }],
      '我今天去菜市場買菜',
    );
    expect(result.map((s) => s.dimension)).toContain('outing');
  });

  it('interaction 的 evidence 不必逐字出現在句中', () => {
    const result = validate(
      [{ ...base, dimension: 'interaction', value: 'checked_in', evidence: '（本次對話）' }],
      '嗯',
    );
    expect(result.map((s) => s.dimension)).toContain('interaction');
  });

  it('模型沒抽 interaction 時自動補上（Baseline 互動維度靠它）', () => {
    const result = validate([], '今天還好');
    expect(result).toHaveLength(1);
    expect(result[0].dimension).toBe('interaction');
  });

  it('不重複補 interaction', () => {
    const result = validate(
      [{ ...base, dimension: 'interaction', value: 'checked_in', evidence: '今天' }],
      '今天還好',
    );
    expect(result.filter((s) => s.dimension === 'interaction')).toHaveLength(1);
  });

  it('日期格式錯誤時退回今天，不丟棄訊號', () => {
    const result = validate(
      [{ ...base, occurredOn: '昨天', dimension: 'meal', value: 'ate', evidence: '吃飯' }],
      '剛剛吃飯了',
    );
    const meal = result.find((s) => s.dimension === 'meal');
    expect(meal?.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('缺少 API key 時拒絕啟動', () => {
    expect(() => new OpenAiLlmAdapter({ get: () => '' } as unknown as ConfigService)).toThrow(
      /LLM_API_KEY/,
    );
  });
});

/**
 * Prompt 內容的回歸測試。
 *
 * 產品原則寫在 prompt 裡，改動 prompt 等於改動產品行為 ——
 * 這些斷言讓「不小心刪掉一條規則」會被測試抓到。
 */
describe('OpenAI prompt 內含產品原則', () => {
  const persona = {
    personaName: '小安',
    templateKey: 'companion' as const,
    elderSalutation: '媽媽',
    initiativeLevel: 'medium' as const,
    reminderStyle: 'gentle' as const,
  };

  it('對話 prompt 明令不做醫療判斷', async () => {
    const { buildChatSystemPrompt } = await import('src/adapters/real/openai-llm.prompts');
    const prompt = buildChatSystemPrompt(persona);
    expect(prompt).toContain('不做任何醫療判斷');
    expect(prompt).toContain('不評估傷勢');
    expect(prompt).toMatch(/不解讀健康數值/);
  });

  it('對話 prompt 含否定與第三人稱規則（SRS §11 驗收項）', async () => {
    const { buildChatSystemPrompt } = await import('src/adapters/real/openai-llm.prompts');
    const prompt = buildChatSystemPrompt(persona);
    expect(prompt).toContain('只抽長者本人的事');
    expect(prompt).toContain('否定句就整個不要抽');
    // 負向值不可進四個統計維度 —— 會被算成一次正向事件，把基線灌高。
    expect(prompt).toContain('stayed_home');
    expect(prompt).toContain('poor_appetite');
  });

  it('pattern 說明 prompt 禁止推測與診斷詞彙', async () => {
    const { EXPLAIN_SYSTEM_PROMPT } = await import('src/adapters/real/openai-llm.prompts');
    expect(EXPLAIN_SYSTEM_PROMPT).toContain('不推測');
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/疑似|風險|症狀/);
  });

  it('週摘要 prompt 要求穩定時極短（SRS F3-02）', async () => {
    const { DIGEST_SYSTEM_PROMPT } = await import('src/adapters/real/openai-llm.prompts');
    expect(DIGEST_SYSTEM_PROMPT).toContain('極短');
    expect(DIGEST_SYSTEM_PROMPT).toContain('不含任何聊天原文');
  });
});
