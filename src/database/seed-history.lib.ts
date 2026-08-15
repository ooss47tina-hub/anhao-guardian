import { DataSource } from 'typeorm';
import { VERSIONS } from 'src/common/versioning/versions';
import { LifeSignal } from 'src/database/entities';
import { SignalDimension } from 'src/domain/signal-dimension';

/**
 * 模擬訊號情境產生器。
 * 供 seed-history CLI 與 /dev 檢視頁共用 —— 兩邊行為必須一致，
 * 否則「CLI 驗過」不等於「畫面上看到的」。
 */

export type Scenario = 'worth_attention' | 'stable' | 'insufficient';

export const SCENARIOS: Scenario[] = ['worth_attention', 'stable', 'insufficient'];

interface DayPlan {
  daysAgo: number;
  counts: Partial<Record<SignalDimension, number>>;
}

const SIGNAL_VALUES: Record<string, string> = {
  interaction: 'checked_in',
  outing: 'went_out',
  meal: 'ate',
  social: 'met_someone',
  sleep_subjective: 'poor_sleep',
};

/**
 * 情境設計。
 *
 * Baseline 視窗是 28 天，且**包含**最近 7 天 —— 所以安靜的那一週會把平均拉低。
 * 下面的數字是照著 PatternEngine 的判定條件（近 7 天日均 ≤ Baseline 日均 × 0.5）
 * 反推出來的，改動前請一併看 pattern-engine.service.ts 的 DEVIATION_RATIO。
 */
export function buildPlan(scenario: Scenario): DayPlan[] {
  const plan: DayPlan[] = [];

  if (scenario === 'insufficient') {
    /**
     * 20 天有資料、最近 7 天完全沒有 → 有效生活日 20 < 21。
     *
     * 這個情境刻意讓多個維度都明顯偏離，才能證明「即使看起來很不對勁，
     * 資料不足時仍然只寫內部記錄、不通知家人」（交接規格 §4、§6）。
     *
     * 注意不能只給少數幾天資料 —— 28 天視窗的平均會被拉到極低，
     * 近 7 天反而顯得偏高，結果是 P0、根本不產生 alert，示範不到重點。
     */
    for (let daysAgo = 27; daysAgo >= 8; daysAgo--) {
      const counts: Partial<Record<SignalDimension, number>> = { interaction: 1, meal: 2 };
      if (daysAgo % 7 < 4) counts.outing = 1;
      if (daysAgo % 7 < 3) counts.social = 1;
      plan.push({ daysAgo, counts });
    }
    return plan;
  }

  for (let daysAgo = 27; daysAgo >= 0; daysAgo--) {
    const isRecentWeek = daysAgo < 7;
    const counts: Partial<Record<SignalDimension, number>> = {
      interaction: 1,
      meal: 2,
    };

    if (scenario === 'stable' || !isRecentWeek) {
      // 平常：外出每週約 4 次、社交每週約 3 次。
      if (daysAgo % 7 < 4) counts.outing = 1;
      if (daysAgo % 7 < 3) counts.social = 1;
    } else {
      // 最近一週：外出與社交各只剩 1 次，兩個維度同時偏離 → P2。
      if (daysAgo === 3) counts.outing = 1;
      if (daysAgo === 5) counts.social = 1;
      if (daysAgo % 2 === 0) counts.sleep_subjective = 1;
    }

    plan.push({ daysAgo, counts });
  }
  return plan;
}

export interface ApplyResult {
  scenario: Scenario;
  totalSignals: number;
  effectiveDays: number;
}

/**
 * 清掉既有訊號與快照後寫入情境資料。
 * 重跑要能得到乾淨結果，否則第二次執行會疊加成兩倍訊號量。
 */
export async function applyScenario(
  dataSource: DataSource,
  elderId: string,
  scenario: Scenario,
): Promise<ApplyResult> {
  await dataSource.query('DELETE FROM alert_signal_link', []);
  await dataSource.query('DELETE FROM notification WHERE alert_id IS NOT NULL', []);
  await dataSource.query('DELETE FROM pattern_alert WHERE elder_id = $1', [elderId]);
  await dataSource.query('DELETE FROM weekly_digest WHERE elder_id = $1', [elderId]);
  await dataSource.query('DELETE FROM life_signal WHERE elder_id = $1', [elderId]);
  await dataSource.query('DELETE FROM baseline_snapshot WHERE elder_id = $1', [elderId]);

  const repo = dataSource.getRepository(LifeSignal);
  const today = new Date();
  let total = 0;

  for (const day of buildPlan(scenario)) {
    const date = new Date(today);
    date.setDate(date.getDate() - day.daysAgo);
    const occurredOn = date.toISOString().slice(0, 10);

    for (const [dimension, count] of Object.entries(day.counts)) {
      for (let i = 0; i < (count ?? 0); i++) {
        await repo.insert({
          elderId,
          messageId: null,
          dimension: dimension as SignalDimension,
          value: SIGNAL_VALUES[dimension] ?? 'seeded',
          confidence: 0.9,
          extractorVersion: VERSIONS.extractor,
          occurredOn,
          reviewState: 'auto_accepted',
          evidence: '（模擬資料）',
        });
        total += 1;
      }
    }
  }

  const rows: Array<{ days: string }> = await dataSource.query(
    'SELECT count(DISTINCT occurred_on) AS days FROM life_signal WHERE elder_id = $1',
    [elderId],
  );

  return { scenario, totalSignals: total, effectiveDays: Number.parseInt(rows[0].days, 10) };
}
