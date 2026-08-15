import { FakeLlmAdapter } from 'src/adapters/fake/fake-llm.adapter';
import { PersonaContext } from 'src/ports/llm.port';

/**
 * SRS 第 11 節評測要求：「不得把否定、他人事件誤寫為本人訊號」。
 *
 * 這裡測的是 FakeLlmAdapter —— 假實作也必須守這條規則，
 * 否則整套測試會給出假的安全感。正式 LLM adapter 接上後，
 * 這組測試應改用 test/fixtures/signal-corpus.json 的 300 句語料跑 Precision ≥ 85%。
 */
describe('Life Signal 萃取：否定與第三人稱', () => {
  const llm = new FakeLlmAdapter();

  const persona: PersonaContext = {
    personaName: '小安',
    templateKey: 'companion',
    elderSalutation: '媽媽',
    initiativeLevel: 'medium',
    reminderStyle: 'gentle',
  };

  async function extract(utterance: string) {
    const result = await llm.chatTurn({
      elderId: 'elder-1',
      personaContext: persona,
      confirmedMemories: [],
      recentTurns: [],
      utterance,
    });
    // interaction 是「有講話」本身產生的，不算內容訊號。
    return result.extractedSignals.filter((s) => s.dimension !== 'interaction');
  }

  it('正常語句萃取到對應維度', async () => {
    const signals = await extract('今天早上我去市場買菜');
    expect(signals.map((s) => s.dimension)).toContain('outing');
  });

  it('否定語句不得產生正向訊號', async () => {
    const signals = await extract('今天沒有出門');
    expect(signals.map((s) => s.dimension)).not.toContain('outing');
  });

  it('第三人稱事件不得寫成本人訊號', async () => {
    const signals = await extract('我朋友昨天去公園散步');
    expect(signals).toHaveLength(0);
  });

  it('每個訊號都帶信心值與依據，供人工抽查回溯', async () => {
    const signals = await extract('昨天跟秀琴去公園走走，晚上睡不好');
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(signal.confidence).toBeGreaterThan(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
      expect(signal.evidence).toBeTruthy();
      expect(signal.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('回傳的 model/prompt 版本非空，供通知回溯（交接規格 §6）', async () => {
    const result = await llm.chatTurn({
      elderId: 'elder-1',
      personaContext: persona,
      confirmedMemories: [],
      recentTurns: [],
      utterance: '今天還好',
    });
    expect(result.modelVersion).toBeTruthy();
    expect(result.promptVersion).toBeTruthy();
  });
});

/**
 * SRS F3-02：全週穩定時摘要應極短。
 */
describe('Weekly Digest 措辭', () => {
  const llm = new FakeLlmAdapter();

  it('穩定時輸出極短摘要', async () => {
    const digest = await llm.composeDigest({ dimensionSummary: [], upcomingTasks: [], stable: true });
    expect(digest.body.length).toBeLessThan(30);
  });
});
