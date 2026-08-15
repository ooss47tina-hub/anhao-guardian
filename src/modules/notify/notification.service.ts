import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ConsentService } from 'src/common/consent/consent.service';
import { DiagnosticLanguageFilter } from 'src/common/safety/diagnostic-language.filter';
import {
  AlertAck,
  Guardian,
  GuardianLink,
  Notification,
  NotificationKind,
  PatternAlert,
} from 'src/database/entities';
import { AlertLevel, bypassesQuietHours, isNotifiableLevel } from 'src/domain/signal-dimension';
import { LINE_PORT, LinePort } from 'src/ports/line.port';

export type SuppressedReason =
  | 'level_not_notifiable'
  | 'internal_only_insufficient_baseline'
  | 'quiet_hours'
  | 'guardian_muted_type'
  | 'consent_pattern_share_missing'
  | 'no_primary_guardian';

export interface DispatchResult {
  notificationId: string;
  sent: boolean;
  suppressedReason: SuppressedReason | null;
}

/**
 * 通知派送。
 *
 * 交接規格 §2.4：「被安靜時段或偏好抑制者仍寫入，記 suppressed_reason」。
 * 這是刻意設計 —— 沒送出的通知也要留紀錄，否則事後無法解釋家人為什麼沒收到。
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(GuardianLink) private readonly links: Repository<GuardianLink>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(AlertAck) private readonly acks: Repository<AlertAck>,
    private readonly consent: ConsentService,
    private readonly diagnosticFilter: DiagnosticLanguageFilter,
    private readonly config: ConfigService,
    @Inject(LINE_PORT) private readonly line: LinePort,
  ) {}

  /**
   * 派送 Pattern 通知。
   *
   * 判斷順序刻意由「產品原則」到「使用者偏好」：
   * 先擋掉不該送的（等級、資料不足、授權），再看使用者設定（靜音、安靜時段）。
   * 這樣 suppressed_reason 會落在最根本的原因上，事後好追。
   */
  async dispatchAlert(alert: PatternAlert, now = new Date()): Promise<DispatchResult> {
    const primary = await this.primaryGuardian(alert.elderId);

    if (!primary) {
      return this.write(alert, null, 'no_primary_guardian', now);
    }

    // 只有 P2／P3 或明確待辦才會打擾家人（交接規格 §1 Notify、SRS F3-03）。
    if (!isNotifiableLevel(alert.level)) {
      return this.write(alert, primary.guardianId, 'level_not_notifiable', now);
    }

    // 有效生活日不足時不得產生家人通知（交接規格 §6）。
    if (alert.internalOnly) {
      return this.write(alert, primary.guardianId, 'internal_only_insufficient_baseline', now);
    }

    if (!(await this.consent.has(alert.elderId, 'pattern_share'))) {
      return this.write(alert, primary.guardianId, 'consent_pattern_share_missing', now);
    }

    if (await this.hasMutedType(alert)) {
      return this.write(alert, primary.guardianId, 'guardian_muted_type', now);
    }

    const guardian = await this.guardians.findOneByOrFail({ id: primary.guardianId });

    // P3 高風險不受安靜時段限制（交接規格 §4 safety_rule）。
    if (!bypassesQuietHours(alert.level) && this.inQuietHours(guardian, now)) {
      return this.write(alert, primary.guardianId, 'quiet_hours', now);
    }

    // 推播文字同樣不得含診斷式語言。
    this.diagnosticFilter.assertClean(alert.headline);

    await this.line.push({
      lineUserId: guardian.lineUserId,
      text: alert.headline,
      quickReplies: ['已聯絡', '判斷不準', '不用再提醒'],
    });

    return this.write(alert, primary.guardianId, null, now);
  }

  /**
   * 高風險即時通知。不受安靜時段、不受 pattern_share 授權限制。
   *
   * 交接規格 §4：「高風險語句命中不等 Pattern，立即通知並進人工佇列，
   * 不受安靜時段限制。」安全高於偏好設定。
   */
  async dispatchSafetyAlert(input: {
    elderId: string;
    headline: string;
    now?: Date;
  }): Promise<DispatchResult> {
    const now = input.now ?? new Date();
    const primary = await this.primaryGuardian(input.elderId);

    if (!primary) {
      const record = await this.notifications.save(
        this.notifications.create({
          recipientType: 'guardian',
          recipientId: input.elderId, // 無主要守護者時仍留紀錄，供 Admin 佇列處理
          kind: 'safety_alert',
          payload: { headline: input.headline, elderId: input.elderId },
          alertId: null,
          sentAt: null,
          suppressedReason: 'no_primary_guardian',
        }),
      );
      this.logger.warn(`長者 ${input.elderId} 高風險事件無主要守護者可通知`);
      return { notificationId: record.id, sent: false, suppressedReason: 'no_primary_guardian' };
    }

    const guardian = await this.guardians.findOneByOrFail({ id: primary.guardianId });
    await this.line.push({ lineUserId: guardian.lineUserId, text: input.headline });

    const record = await this.notifications.save(
      this.notifications.create({
        recipientType: 'guardian',
        recipientId: primary.guardianId,
        kind: 'safety_alert',
        payload: { headline: input.headline, elderId: input.elderId },
        alertId: null,
        sentAt: now,
        suppressedReason: null,
      }),
    );
    return { notificationId: record.id, sent: true, suppressedReason: null };
  }

  private async write(
    alert: PatternAlert,
    guardianId: string | null,
    reason: SuppressedReason | null,
    now: Date,
  ): Promise<DispatchResult> {
    const record = await this.notifications.save(
      this.notifications.create({
        recipientType: 'guardian',
        recipientId: guardianId ?? alert.elderId,
        kind: 'pattern_alert' as NotificationKind,
        payload: { headline: alert.headline, level: alert.level, alertId: alert.id },
        alertId: alert.id,
        sentAt: reason ? null : now,
        suppressedReason: reason,
      }),
    );
    if (reason) {
      this.logger.debug(`alert ${alert.id} 未送出：${reason}`);
    }
    return { notificationId: record.id, sent: !reason, suppressedReason: reason };
  }

  private async primaryGuardian(elderId: string): Promise<GuardianLink | null> {
    return this.links.findOne({
      where: { elderId, isPrimary: true, revokedAt: IsNull() },
    });
  }

  /** 守護者曾對同類型回饋「不用再提醒」（交接規格 §2.3 alert_ack.feedback）。 */
  private async hasMutedType(alert: PatternAlert): Promise<boolean> {
    const muted = await this.acks
      .createQueryBuilder('a')
      .innerJoin(PatternAlert, 'p', 'p.id = a.alert_id')
      .where('p.elder_id = :elderId', { elderId: alert.elderId })
      .andWhere('a.feedback = :feedback', { feedback: 'mute_this_type' })
      .andWhere('p.dimensions @> :dims::jsonb', { dims: JSON.stringify(alert.dimensions) })
      .getCount();
    return muted > 0;
  }

  /**
   * 安靜時段判斷。支援跨午夜（22:00 – 07:30）。
   * 守護者未設定時退回系統預設值。
   */
  private inQuietHours(guardian: Guardian, now: Date): boolean {
    const start = guardian.quietHoursStart ?? this.config.get<string>('rules.quietHoursStart') ?? '22:00';
    const end = guardian.quietHoursEnd ?? this.config.get<string>('rules.quietHoursEnd') ?? '07:30';

    const minutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const startMin = toMinutes(start);
    const endMin = toMinutes(end);

    return startMin <= endMin
      ? minutes >= startMin && minutes < endMin
      : minutes >= startMin || minutes < endMin;
  }

  /** 供 level 檢查的公開輔助，測試與其他模組共用。 */
  static isNotifiable(level: AlertLevel): boolean {
    return isNotifiableLevel(level);
  }
}
