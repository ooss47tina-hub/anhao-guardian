import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from 'src/app.module';
import { JobName, JobsService } from './jobs.service';

/**
 * 手動觸發排程作業。
 *
 *   npm run job -- baseline_rebuild
 *   npm run job -- pattern_detect
 *   npm run job -- pattern_detect 2026-08-15T09:00:00
 *
 * 驗收時用得到：交接規格 §4 的每個 job 都要能單獨重跑並看到結果。
 *
 * 第二個參數是「假裝現在是這個時間」。沒有它的話，在安靜時段（22:00–07:30）
 * 驗收會看到通知被抑制，容易誤判為壞掉 —— 那其實是正確行為。
 */
const HANDLERS: Record<JobName, (jobs: JobsService, now: Date) => Promise<unknown>> = {
  activity_sync: (jobs) => jobs.activitySync(),
  health_record_sync: (jobs) => jobs.healthRecordSync(),
  baseline_rebuild: (jobs, now) => jobs.baselineRebuild(now),
  pattern_detect: (jobs, now) => jobs.patternDetect(now),
  digest_build: (jobs, now) => jobs.digestBuild(now),
  eligibility_check: (jobs) => jobs.eligibilityCheck(),
  partition_maintenance: (jobs) => jobs.partitionMaintenance(),
};

async function main(): Promise<void> {
  const logger = new Logger('job-cli');
  const name = process.argv[2] as JobName | undefined;

  if (!name || !(name in HANDLERS)) {
    logger.error(`用法：npm run job -- <${Object.keys(HANDLERS).join('|')}> [ISO 時間]`);
    process.exit(1);
  }

  const nowArg = process.argv[3];
  const now = nowArg ? new Date(nowArg) : new Date();
  if (Number.isNaN(now.getTime())) {
    logger.error(`無法解析時間：${nowArg}`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    const result = await HANDLERS[name](app.get(JobsService), now);
    logger.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

void main();
