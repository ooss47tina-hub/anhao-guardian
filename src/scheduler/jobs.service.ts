import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Elder, PatternAlert } from 'src/database/entities';
import { BaselineService } from 'src/modules/baseline/baseline.service';
import { PatternEngineService } from 'src/modules/detect/pattern-engine.service';
import { DigestService } from 'src/modules/notify/digest.service';
import { NotificationService } from 'src/modules/notify/notification.service';
import { PublicHealthService } from 'src/modules/publicdata/public-health.service';

export type JobName =
  | 'activity_sync'
  | 'health_record_sync'
  | 'baseline_rebuild'
  | 'pattern_detect'
  | 'digest_build'
  | 'eligibility_check'
  | 'partition_maintenance';

export interface JobResult {
  job: JobName;
  processed: number;
  failed: number;
  notes: string[];
}

/**
 * 排程作業。對應交接規格 §4。
 *
 * safety_rule 不在這裡 —— 它是即時的，由 ConversationService 在收到訊息時直接觸發，
 * 不等 Pattern、不受安靜時段限制。
 *
 * 每個 job 都可用 `npm run job -- <name>` 手動觸發，方便驗收與重跑。
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectRepository(Elder) private readonly elders: Repository<Elder>,
    @InjectRepository(PatternAlert) private readonly alerts: Repository<PatternAlert>,
    private readonly baseline: BaselineService,
    private readonly pattern: PatternEngineService,
    private readonly digest: DigestService,
    private readonly notifications: NotificationService,
    private readonly publicHealth: PublicHealthService,
    private readonly dataSource: DataSource,
  ) {}

  /** 每日 05:30 — 抓取社區據點活動開放資料。 */
  @Cron('30 5 * * *')
  async activitySync(): Promise<JobResult> {
    const result = this.emptyResult('activity_sync');
    const regions = await this.elders
      .createQueryBuilder('e')
      .select('DISTINCT e.region_code', 'regionCode')
      .where('e.region_code IS NOT NULL')
      .getRawMany<{ regionCode: string }>();

    for (const { regionCode } of regions) {
      try {
        const count = await this.publicHealth.syncActivities(regionCode);
        result.processed += count;
      } catch (error) {
        // 失敗改用快取並標 data_as_of（交接規格 §4）。
        // 快取判斷在讀取端（PublicHealthService.nearbyActivities），這裡只需不中斷其他區。
        result.failed += 1;
        result.notes.push(`${regionCode}: ${(error as Error).message}，改用既有快取`);
      }
    }
    return this.log(result);
  }

  /** 每日 06:00 — 健康存摺同步。授權到期者停止取用並發重新授權請求。 */
  @Cron('0 6 * * *')
  async healthRecordSync(): Promise<JobResult> {
    const result = this.emptyResult('health_record_sync');
    for (const elder of await this.activeElders()) {
      try {
        const synced = await this.publicHealth.syncHealthRecords(elder.id);
        result.processed += synced.synced;
        if (synced.reason) result.notes.push(`${elder.id}: ${synced.reason}`);
      } catch (error) {
        result.failed += 1;
        result.notes.push(`${elder.id}: ${(error as Error).message}`);
      }
    }
    return this.log(result);
  }

  /** 每日 07:00 — 重算 28 天分維度基線並寫入 baseline_snapshot。 */
  @Cron('0 7 * * *')
  async baselineRebuild(now = new Date()): Promise<JobResult> {
    const result = this.emptyResult('baseline_rebuild');
    for (const elder of await this.activeElders()) {
      try {
        await this.baseline.writeSnapshot(elder.id, now);
        result.processed += 1;
      } catch (error) {
        result.failed += 1;
        result.notes.push(`${elder.id}: ${(error as Error).message}`);
      }
    }
    return this.log(result);
  }

  /**
   * 每日 07:30 — Pattern 比對。
   * 有效生活日 < 門檻者只寫內部記錄，不通知家人（交接規格 §4）。
   */
  @Cron('30 7 * * *')
  async patternDetect(now = new Date()): Promise<JobResult> {
    const result = this.emptyResult('pattern_detect');
    for (const elder of await this.activeElders()) {
      try {
        const detection = await this.pattern.detect(elder.id, now);
        result.processed += 1;

        if (!detection.alertId) continue;

        const alert = await this.alerts.findOneByOrFail({ id: detection.alertId });
        const dispatch = await this.notifications.dispatchAlert(alert, now);

        if (dispatch.suppressedReason) {
          result.notes.push(`${elder.id}: ${detection.level} 未送出（${dispatch.suppressedReason}）`);
        }
      } catch (error) {
        result.failed += 1;
        result.notes.push(`${elder.id}: ${(error as Error).message}`);
      }
    }
    return this.log(result);
  }

  /** 每週一 09:00 — 產生並推送週摘要。 */
  @Cron('0 9 * * 1')
  async digestBuild(now = new Date()): Promise<JobResult> {
    const result = this.emptyResult('digest_build');
    const weekStart = this.mondayOf(now);

    for (const elder of await this.activeElders()) {
      try {
        const digest = await this.digest.build(elder.id, weekStart);
        await this.digest.send(digest, now);
        result.processed += 1;
      } catch (error) {
        result.failed += 1;
        result.notes.push(`${elder.id}: ${(error as Error).message}`);
      }
    }
    return this.log(result);
  }

  /** 每週一 09:00 — 國健署成人預防保健資格查詢。 */
  @Cron('0 9 * * 1')
  async eligibilityCheck(): Promise<JobResult> {
    const result = this.emptyResult('eligibility_check');
    for (const elder of await this.activeElders()) {
      try {
        const eligibility = await this.publicHealth.checkEligibility(elder.id);
        result.processed += 1;
        if (eligibility.degraded) {
          result.notes.push(`${elder.id}: 以「上次日期 + 1 年」推算，已標 degraded`);
        }
      } catch (error) {
        result.failed += 1;
        result.notes.push(`${elder.id}: ${(error as Error).message}`);
      }
    }
    return this.log(result);
  }

  /**
   * 每日 03:00 — 預開未來三個月的分區。
   * 規格未列此項，但分區表缺分區會讓 INSERT 直接失敗，屬必要維運作業。
   */
  @Cron('0 3 * * *')
  async partitionMaintenance(): Promise<JobResult> {
    const result = this.emptyResult('partition_maintenance');
    await this.dataSource.query('SELECT ensure_monthly_partitions(3)');
    result.processed = 1;
    return this.log(result);
  }

  private async activeElders(): Promise<Elder[]> {
    return this.elders.find({ where: { status: 'active' } });
  }

  private mondayOf(date: Date): Date {
    const monday = new Date(date);
    const day = monday.getDay();
    monday.setDate(monday.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  private emptyResult(job: JobName): JobResult {
    return { job, processed: 0, failed: 0, notes: [] };
  }

  private log(result: JobResult): JobResult {
    this.logger.log(
      `${result.job} 完成：processed=${result.processed} failed=${result.failed}` +
        (result.notes.length ? `\n  ${result.notes.join('\n  ')}` : ''),
    );
    return result;
  }
}
