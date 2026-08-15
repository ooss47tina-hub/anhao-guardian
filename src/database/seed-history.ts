import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from 'src/app.module';
import { Elder } from 'src/database/entities';
import { applyScenario, Scenario, SCENARIOS } from './seed-history.lib';

/**
 * 產生 28 天的模擬 Life Signal，讓 Baseline → Pattern → 通知整條鏈路可以真的跑一次。
 *
 *   npm run seed:history                    # 預設 worth_attention 情境
 *   npm run seed:history -- stable
 *   npm run seed:history -- insufficient
 *
 * 這是開發驗收工具，不是測試資料產生器 —— 它刻意產生「剛好會觸發某個結果」的
 * 資料，方便對照介面原型驗收。要驗證判斷邏輯本身請看 test/product-rules/。
 * 情境內容定義在 seed-history.lib.ts，與 /dev 檢視頁共用。
 */
async function main(): Promise<void> {
  const logger = new Logger('seed:history');
  const scenario = (process.argv[2] ?? 'worth_attention') as Scenario;

  if (!SCENARIOS.includes(scenario)) {
    logger.error(`用法：npm run seed:history -- <${SCENARIOS.join('|')}>`);
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

    const result = await applyScenario(dataSource, elder.id, scenario);
    logger.log(
      `情境 ${result.scenario}：寫入 ${result.totalSignals} 筆訊號，有效生活日 ${result.effectiveDays} 天`,
    );
    logger.log('接著執行：');
    logger.log('  npm run job -- baseline_rebuild');
    logger.log('  npm run job -- pattern_detect');
  } finally {
    await app.close();
  }
}

void main();
