import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from 'src/app.module';
import { VERSIONS } from 'src/common/versioning/versions';
import { Elder, LifeSignal } from 'src/database/entities';
import { SignalDimension } from 'src/domain/signal-dimension';

/**
 * 產生 28 天的模擬 Life Signal，讓 Baseline → Pattern → 通知整條鏈路可以真的跑一次。
 *
 *   npm run seed:history                    # 預設 worth_attention 情境
 *   npm run seed:history -- stable
 *   npm run seed:history -- insufficient
 *
 * 這是開發驗收工具，不是測試資料產生器 —— 它刻意產生「剛好會觸發某個結果」的
 * 資料，方便對照介面原型驗收。要驗證判斷邏輯本身請看 test/product-rules/。
 */

type Scenario = 'worth_attention' | 'stable' | 'insufficient';

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
function buildPlan(scenario: Scenario): DayPlan[] {
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

async function main(): Promise<void> {
  const logger = new Logger('seed:history');
  const scenario = (process.argv[2] ?? 'worth_attention') as Scenario;

  if (!['worth_attention', 'stable', 'insufficient'].includes(scenario)) {
    logger.error('用法：npm run seed:history -- <worth_attention|stable|insufficient>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'error'] });

  try {
    const dataSource = app.get(DataSource);
    const elder = await dataSource.getRepository(Elder).findOne({
      where: { lineUserId: 'U-dev-elder-meiling' },
    });

    if (!elder) {
      logger.error('找不到示範長者。請先執行 npm run seed。');
      process.exit(1);
    }

    // 重跑要能得到乾淨結果，否則第二次執行會疊加成兩倍訊號量。
    await dataSource.query('DELETE FROM life_signal WHERE elder_id = $1', [elder.id]);
    await dataSource.query('DELETE FROM baseline_snapshot WHERE elder_id = $1', [elder.id]);

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
            elderId: elder.id,
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

    const effectiveDays: Array<{ days: string }> = await dataSource.query(
      'SELECT count(DISTINCT occurred_on) AS days FROM life_signal WHERE elder_id = $1',
      [elder.id],
    );

    logger.log(`情境 ${scenario}：寫入 ${total} 筆訊號，有效生活日 ${effectiveDays[0].days} 天`);
    logger.log('接著執行：');
    logger.log('  npm run job -- baseline_rebuild');
    logger.log('  npm run job -- pattern_detect');
  } finally {
    await app.close();
  }
}

void main();
