import { ConfigService } from '@nestjs/config';
import { OpenAiSttAdapter } from 'src/adapters/real/openai-stt.adapter';

/**
 * 語音轉文字的信心值推導與輸出淨化。
 *
 * 交接規格 §3：「低於 0.75 要求長者重說，不猜語意。」
 * 這條規則只有在 confidence 真的反映轉寫品質時才有意義 —— 常數信心值
 * 會讓門檻形同虛設，而長者說錯被當成說對，會直接污染 Baseline。
 *
 * 門檻的合理性來自實測（2026-08-15，gpt-4o-transcribe，同一句中文語音）：
 *   清晰               0.912  → 通過
 *   極度劣化但仍可辨識   0.998  → 通過（模型確實救回內容）
 *   含糊單字            0.667  → 擋下
 *   純白噪音            0.046  → 擋下（且幻覺出日文「サンバ。」）
 *
 * 這組測試不呼叫 API，只測推導與淨化邏輯。
 */
describe('OpenAI STT', () => {
  function adapter(): OpenAiSttAdapter {
    const values: Record<string, string> = {
      'stt.apiKey': 'sk-test',
      'stt.model': 'gpt-4o-transcribe',
    };
    return new OpenAiSttAdapter({ get: (k: string) => values[k] } as ConfigService);
  }

  type Internals = {
    deriveConfidence(lp?: Array<{ logprob: number }>): number;
    looksLikeChinese(text: string): boolean;
    fileName(mimeType: string): string;
    toTraditional(text: string): string;
  };
  const internals = () => adapter() as unknown as Internals;

  describe('信心值推導', () => {
    it('logprob 全為 0（完全確定）時信心為 1', () => {
      expect(internals().deriveConfidence([{ logprob: 0 }, { logprob: 0 }])).toBe(1);
    });

    it('用幾何平均，對單一不確定 token 敏感', () => {
      // 一個 token 極不確定（logprob -5 ≈ p 0.0067），其餘確定。
      // 算術平均會被稀釋成 ~0.75；幾何平均應明顯更低。
      const mixed = [{ logprob: 0 }, { logprob: 0 }, { logprob: 0 }, { logprob: -5 }];
      const confidence = internals().deriveConfidence(mixed);
      expect(confidence).toBeLessThan(0.35);
    });

    it('沒有 logprobs 時回傳 0，不編造信心值', () => {
      // 寧可讓長者重說一次，也不要用假信心值通過 0.75 門檻。
      expect(internals().deriveConfidence(undefined)).toBe(0);
      expect(internals().deriveConfidence([])).toBe(0);
    });

    it('實測值落在門檻的正確一側', () => {
      const derive = internals().deriveConfidence;
      // 清晰語音的實測平均 logprob 約 -0.092。
      expect(derive([{ logprob: -0.092 }])).toBeGreaterThan(0.75);
      // 含糊單字約 -0.405。
      expect(derive([{ logprob: -0.405 }])).toBeLessThan(0.75);
      // 純白噪音約 -3.08。
      expect(derive([{ logprob: -3.08 }])).toBeLessThan(0.1);
    });
  });

  describe('輸出淨化', () => {
    it('簡體轉台灣繁體', () => {
      expect(internals().toTraditional('我早上去菜市场买菜')).toBe('我早上去菜市場買菜');
    });

    it('已是繁體時不變動', () => {
      const text = '我早上去菜市場買菜，晚上睡不太好';
      expect(internals().toTraditional(text)).toBe(text);
    });

    it.each(['我早上去菜市場買菜', '嗯，還好', '去看王醫師'])(
      '中文轉寫視為有效：%s',
      (text) => {
        expect(internals().looksLikeChinese(text)).toBe(true);
      },
    );

    /**
     * 實測發現：聽不清時模型會漂到日文，即使指定 language=zh。
     * 純白噪音得到「サンバ。」、含糊單字得到「うん。」。
     * 這兩例的信心值都夠低，但不能只靠信心值 —— 日文轉寫若僥倖高信心，
     * 會被當成長者真的說了那句話。
     */
    it.each(['サンバ。', 'うん。', '안녕하세요', 'hello there', '...'])(
      '非中文轉寫視為聽不清：%s',
      (text) => {
        expect(internals().looksLikeChinese(text)).toBe(false);
      },
    );
  });

  describe('檔名副檔名', () => {
    it.each([
      ['audio/mpeg', 'audio.mp3'],
      ['audio/m4a', 'audio.m4a'],
      ['audio/x-m4a', 'audio.m4a'],
      ['audio/wav', 'audio.wav'],
      ['audio/ogg', 'audio.ogg'],
      // LINE 的語音是 m4a，content-type 常帶 charset。
      ['audio/mp4; charset=utf-8', 'audio.mp4'],
      // 未知型別退回 m4a（LINE 的預設格式），不要讓請求整個失敗。
      ['application/octet-stream', 'audio.m4a'],
    ])('%s → %s', (mime, expected) => {
      expect(internals().fileName(mime)).toBe(expected);
    });
  });

  it('缺少 API key 時拒絕啟動', () => {
    expect(() => new OpenAiSttAdapter({ get: () => '' } as unknown as ConfigService)).toThrow(
      /STT_API_KEY/,
    );
  });
});
