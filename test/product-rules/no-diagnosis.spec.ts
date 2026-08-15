import { DiagnosticLanguageError } from 'src/common/errors/product-rule.errors';
import { DiagnosticLanguageFilter } from 'src/common/safety/diagnostic-language.filter';
import { SafetyRuleService } from 'src/common/safety/safety-rule.service';

/**
 * 交接規格 §6：「系統不輸出診斷、不評估傷勢、不做健康判讀。」
 * SRS F2-02：不得使用「可能罹患…」「疑似失智」等診斷式語言。
 */
describe('產品原則：不輸出診斷', () => {
  const filter = new DiagnosticLanguageFilter();

  it.each([
    ['媽媽可能罹患憂鬱症', '可能罹患'],
    ['疑似失智，建議就醫', '疑似疾病'],
    ['輕微骨折，休息幾天就好', '傷勢評估'],
    ['血糖偏高，要注意飲食', '健康數值判讀'],
    ['有跌倒的風險', '風險預測'],
  ])('攔截診斷式語句：%s', (text, expectedLabel) => {
    const result = filter.inspect(text);
    expect(result.clean).toBe(false);
    expect(result.matched).toContain(expectedLabel);
    expect(() => filter.assertClean(text)).toThrow(DiagnosticLanguageError);
  });

  it.each([
    '近 7 天外出訊號 1 次；個人近 28 天平均每週 4 次。',
    '媽媽本週生活型態與平常大致一致，無需特別處理。',
    '週末打個電話，聊天氣和公園，不要一開口就問身體。',
    '這些是醫院量的數字，我只是幫你放在一起看。',
  ])('放行非診斷語句：%s', (text) => {
    expect(filter.inspect(text).clean).toBe(true);
    expect(() => filter.assertClean(text)).not.toThrow();
  });
});

/**
 * 交接規格 §4 safety_rule：高風險語句命中不等 Pattern，立即通知。
 * SRS 第 11 節：安全規則 Recall 目標 100%。
 */
describe('產品原則：高風險語句規則', () => {
  const safety = new SafetyRuleService();

  it.each([
    ['我剛剛在浴室滑了一下', 'fall'],
    ['我跌倒了，站不起來', 'fall'],
    ['胸口痛得厲害', 'chest_pain'],
    ['我喘不過氣', 'breathing'],
    ['活著沒意思', 'self_harm'],
    ['傷口一直流血', 'bleeding'],
    ['剛剛昏倒了', 'unconscious'],
  ])('命中高風險：%s → %s', (utterance, category) => {
    const hits = safety.evaluate(utterance);
    expect(hits.map((h) => h.category)).toContain(category);
    expect(safety.isHighRisk(utterance)).toBe(true);
  });

  it('回應提示不含診斷或傷勢評估', () => {
    for (const utterance of ['我跌倒了', '胸口痛', '我喘不過氣']) {
      for (const hit of safety.evaluate(utterance)) {
        expect(() => filterFor(hit.responseHint)).not.toThrow();
      }
    }
  });

  it.each(['今天早上我去市場買菜', '昨天跟秀琴去公園走走', '晚上煮了魚湯'])(
    '日常語句不誤判為高風險：%s',
    (utterance) => {
      expect(safety.isHighRisk(utterance)).toBe(false);
    },
  );

  function filterFor(text: string): void {
    new DiagnosticLanguageFilter().assertClean(text);
  }
});
