import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsentService } from 'src/common/consent/consent.service';
import {
  CheckupEligibility,
  CommunityActivityRecord,
  Elder,
  GovHealthRecord,
} from 'src/database/entities';
import {
  ACTIVITY_MAX_DISTANCE_KM,
  COMMUNITY_ACTIVITY_PORT,
  CommunityActivityPort,
} from 'src/ports/community-activity.port';
import { CRYPTO_PORT, CryptoPort } from 'src/ports/crypto.port';
import { HPA_ELIGIBILITY_PORT, HpaEligibilityPort } from 'src/ports/hpa-eligibility.port';
import { MY_HEALTH_BANK_PORT, MyHealthBankPort } from 'src/ports/my-health-bank.port';

export interface PublicHealthView {
  eligibility: CheckupEligibility | null;
  labs: Array<{ name: string; value: string; unit: string | null }>;
  /** 前端據此標註「資料未即時更新」。 */
  dataAsOf: string | null;
  activities: Array<{ title: string; when: string; place: string }>;
}

/**
 * E-06 健檢與社區活動（交接規格 §5）。
 *
 * 三條硬規則：
 * 1. 健檢數值原樣呈現，不做衍生判讀，異常值不觸發家人通知。
 * 2. 健檢資格查詢失敗時降級推算並標 degraded。
 * 3. 社區活動快取超過 14 天不得顯示。
 */
@Injectable()
export class PublicHealthService {
  private readonly logger = new Logger(PublicHealthService.name);

  constructor(
    @InjectRepository(Elder) private readonly elders: Repository<Elder>,
    @InjectRepository(GovHealthRecord) private readonly records: Repository<GovHealthRecord>,
    @InjectRepository(CheckupEligibility) private readonly eligibility: Repository<CheckupEligibility>,
    @InjectRepository(CommunityActivityRecord) private readonly activities: Repository<CommunityActivityRecord>,
    private readonly consent: ConsentService,
    private readonly config: ConfigService,
    @Inject(CRYPTO_PORT) private readonly crypto: CryptoPort,
    @Inject(MY_HEALTH_BANK_PORT) private readonly myHealthBank: MyHealthBankPort,
    @Inject(HPA_ELIGIBILITY_PORT) private readonly hpa: HpaEligibilityPort,
    @Inject(COMMUNITY_ACTIVITY_PORT) private readonly community: CommunityActivityPort,
  ) {}

  /** GET /v1/elders/:id/public-health（交接規格 §3）。 */
  async view(elderId: string, now = new Date()): Promise<PublicHealthView> {
    const elder = await this.elders.findOneByOrFail({ id: elderId });
    const hasMedicalConsent = await this.consent.has(elderId, 'medical');

    const year = now.getFullYear();
    const eligibility = hasMedicalConsent
      ? await this.eligibility.findOne({ where: { elderId, year } })
      : null;

    const latestRecord = hasMedicalConsent
      ? await this.records.findOne({ where: { elderId }, order: { examDate: 'DESC' } })
      : null;

    const labs = latestRecord
      ? (JSON.parse(await this.crypto.decrypt(latestRecord.payloadEncrypted)) as PublicHealthView['labs'])
      : [];

    return {
      eligibility,
      // 原樣呈現。不加「偏高／偏低」，不排序、不標色（交接規格 §5）。
      labs,
      dataAsOf: latestRecord?.dataAsOf ?? null,
      activities: await this.nearbyActivities(elder.regionCode, now),
    };
  }

  /**
   * 每日 06:00 health_record_sync。
   * 授權到期者停止取用並發重新授權請求（交接規格 §4）。
   */
  async syncHealthRecords(elderId: string): Promise<{ synced: number; reason?: string }> {
    const elder = await this.elders.findOneByOrFail({ id: elderId });

    if (!elder.healthCardToken) {
      return { synced: 0, reason: 'no_health_card_token' };
    }
    if (!this.myHealthBank.isAuthorizationValid(elder.healthCardToken, elder.healthCardTokenExpiresAt)) {
      this.logger.warn(`長者 ${elderId} 健康存摺授權已到期，停止取用`);
      return { synced: 0, reason: 'authorization_expired' };
    }

    const snapshots = await this.myHealthBank.fetchHealthRecords(elder.healthCardToken);

    for (const snapshot of snapshots) {
      // 原始 JSON 不落地：只留 labs 必要欄位再加密（交接規格 §5）。
      const payload = JSON.stringify(snapshot.labs);
      await this.records
        .createQueryBuilder()
        .insert()
        .values({
          elderId,
          sourceSystem: 'myhealthbank',
          examDate: snapshot.examDate,
          payloadEncrypted: await this.crypto.encrypt(payload),
          fetchedAt: new Date(),
          dataAsOf: snapshot.dataAsOf,
        })
        .orIgnore()
        .execute();
    }

    return { synced: snapshots.length };
  }

  /**
   * 每週一 09:00 eligibility_check。
   * 失敗時以「上次日期 + 1 年」推算並標 degraded（交接規格 §5）。
   */
  async checkEligibility(elderId: string, program = 'adult_preventive_care'): Promise<CheckupEligibility> {
    const elder = await this.elders.findOneByOrFail({ id: elderId });
    const year = new Date().getFullYear();

    const result = await this.hpa.checkEligibility({
      elderToken: elder.healthCardToken ?? '',
      program,
      year,
    });

    await this.eligibility
      .createQueryBuilder()
      .insert()
      .values({
        elderId,
        program,
        year,
        available: result.available,
        lastUsedDate: result.lastUsedDate,
        checkedAt: new Date(),
        degraded: result.degraded,
      })
      .orUpdate(['available', 'last_used_date', 'checked_at', 'degraded'], ['elder_id', 'program', 'year'])
      .execute();

    return this.eligibility.findOneByOrFail({ elderId, program, year });
  }

  /** 每日 05:30 activity_sync。 */
  async syncActivities(regionCode: string): Promise<number> {
    const fetched = await this.community.fetchByRegion(regionCode);
    const now = new Date();

    for (const activity of fetched) {
      await this.activities.save(
        this.activities.create({
          stationName: activity.stationName,
          title: activity.title,
          startAt: new Date(activity.startAt),
          geo: activity.geo,
          regionCode: activity.regionCode,
          sourceDataset: activity.sourceDataset,
          fetchedAt: now,
        }),
      );
    }
    return fetched.length;
  }

  /**
   * 附近活動。
   * 快取超過 14 天不得顯示（交接規格 §5）—— 過期的活動資訊會讓長者白跑一趟。
   */
  private async nearbyActivities(
    regionCode: string | null,
    now: Date,
  ): Promise<PublicHealthView['activities']> {
    if (!regionCode) return [];

    const maxCacheDays = this.config.get<number>('rules.communityActivityMaxCacheDays') ?? 14;
    const freshAfter = new Date(now.getTime() - maxCacheDays * 24 * 60 * 60 * 1000);

    const rows = await this.activities
      .createQueryBuilder('a')
      .where('a.region_code = :regionCode', { regionCode })
      .andWhere('a.fetched_at >= :freshAfter', { freshAfter })
      .andWhere('a.start_at >= :now', { now })
      .orderBy('a.start_at', 'ASC')
      .take(10)
      .getMany();

    if (rows.length === 0) {
      this.logger.debug(`${regionCode} 無 ${maxCacheDays} 天內的活動快取，不顯示`);
    }

    return rows.map((a) => ({
      title: a.title,
      when: a.startAt.toISOString(),
      place: a.stationName,
    }));
  }

  /**
   * 距離過濾。交接規格 §5：住家 1.5 公里、步行 20 分鐘內。
   *
   * 目前 elder 只存 region_code、不存座標（不做定位是產品原則），
   * 所以實際距離過濾需要長者在 E-06 自行提供大致位置。
   * TODO(product)：確認取得方式後接上；在此之前只做 region_code 過濾。
   */
  static withinWalkingDistance(
    home: { lat: number; lng: number },
    place: { lat: number; lng: number },
  ): boolean {
    const R = 6371;
    const dLat = ((place.lat - home.lat) * Math.PI) / 180;
    const dLng = ((place.lng - home.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((home.lat * Math.PI) / 180) *
        Math.cos((place.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const distanceKm = 2 * R * Math.asin(Math.sqrt(a));
    return distanceKm <= ACTIVITY_MAX_DISTANCE_KM;
  }
}
