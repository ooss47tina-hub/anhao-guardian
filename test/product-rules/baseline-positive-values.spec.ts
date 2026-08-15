import {
  BASELINE_DIMENSIONS,
  BASELINE_POSITIVE_VALUES,
  POSITIVE_SIGNAL_VALUES,
} from 'src/domain/signal-dimension';

/**
 * Baseline 只計入「事情真的發生了」的訊號值。
 *
 * 這條規則不在交接規格裡 —— 它是實測 LLM 行為時發現的缺陷：
 * 模型抽出 `outing=stayed_home`（待在家），而 Baseline 與 Pattern 都是
 * 按維度數「筆數」、不看 value，於是「待在家」被算成一次外出，
 * 把基線灌高，接著讓「近 7 天外出變少」的判斷失準。
 *
 * 假實作的 `meal=poor_appetite`（沒胃口）有同樣問題。
 */
describe('Baseline 只計入正向訊號值', () => {
  it('四個 Baseline 維度都必須有正向值清單', () => {
    for (const dimension of BASELINE_DIMENSIONS) {
      expect(POSITIVE_SIGNAL_VALUES[dimension].length).toBeGreaterThan(0);
    }
  });

  it('負向值不在計入清單中', () => {
    // 這些是 LLM 與假實作實際產生過的負向值。
    for (const negative of ['stayed_home', 'poor_appetite', 'no_outing', 'skipped_meal']) {
      expect(BASELINE_POSITIVE_VALUES).not.toContain(negative);
    }
  });

  it('不進 Baseline 統計的維度不提供正向值', () => {
    // sleep / mood / concern / task 是敘述性維度，計次沒有意義。
    for (const dimension of ['sleep_subjective', 'mood', 'concern', 'task'] as const) {
      expect(POSITIVE_SIGNAL_VALUES[dimension]).toHaveLength(0);
      for (const value of POSITIVE_SIGNAL_VALUES[dimension]) {
        expect(BASELINE_POSITIVE_VALUES).not.toContain(value);
      }
    }
  });

  it('扁平清單只含四個 Baseline 維度的值', () => {
    const expected = BASELINE_DIMENSIONS.flatMap((d) => POSITIVE_SIGNAL_VALUES[d]);
    expect(BASELINE_POSITIVE_VALUES.sort()).toEqual(expected.sort());
  });
});
