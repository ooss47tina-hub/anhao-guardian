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
 *
 * 驗收時用得到：交接規格 §4 的每個 job 都要能單獨重跑並看到結果。
 */
const HANDLERS: Record<JobName, (jobs: JobsService) => Promise<unknown>> = {
  activity_sync: (jobs) => jobs.activitySync(),
  health_record_sync: (jobs) => jobs.healthRecordSync(),
  baseline_rebuild: (jobs) => jobs.baselineRebuild(),
  pattern_detect: (jobs) => jobs.patternDetect(),
  digest_build: (jobs) => jobs.digestBuild(),
  eligibility_check: (jobs) => jobs.eligibilityCheck(),
  partition_maintenance: (jobs) => jobs.partitionMaintenance(),
};

async function main(): Promise<void> {
  const logger = new Logger('job-cli');
  const name = process.argv[2] as JobName | undefined;

  if (!name || !(name in HANDLERS)) {
    logger.error(`用法：npm run job -- <${Object.keys(HANDLERS).join('|')}>`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    const result = await HANDLERS[name](app.get(JobsService));
    logger.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

void main();
