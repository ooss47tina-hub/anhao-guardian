import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ConsentService } from 'src/common/consent/consent.service';
import { RawChatAccessDeniedError } from 'src/common/errors/product-rule.errors';
import {
  AlertSignalLink,
  BaselineSnapshot,
  Elder,
  GuardianLink,
  LifeSignal,
  MedicalJourney,
  PatternAlert,
  WeeklyDigest,
} from 'src/database/entities';
import { DIMENSION_LABELS, SignalDimension } from 'src/domain/signal-dimension';
import { BaselineService } from 'src/modules/baseline/baseline.service';

/** G-01 首頁只呈現三種狀態（SRS F3-01）。 */
export type ElderStatusLabel = 'stable' | 'insufficient_data' | 'worth_attention';

export interface ElderStatusView {
  elderId: string;
  displayName: string;
  status: ElderStatusLabel;
  /** 一句 AI Summary。不含聊天原文。 */
  summary: string;
  updatedAt: string;
  recentEvents: Array<{ when: string; text: string; tag: string; alertId?: string }>;
}

export interface AlertDetailView {
  id: string;
  level: string;
  headline: string;
  explanation: string;
  createdAt: string;
  versions: { rule: string; model: string; prompt: string };
  baselineSnapshotId: string | null;
  comparison: Array<{ dimension: SignalDimension; label: string; recent: number; baseline: number }>;
  /** 支撐訊號。只給維度、時間與信心，不給原句（除非 raw_chat_share）。 */
  supportingSignals: Array<{ dimension: SignalDimension; occurredOn: string; confidence: number; quote?: string }>;
}

/**
 * 守護者端的唯讀視圖。
 *
 * 這個 service 刻意不注入 MessageRepository。
 * 交接規格 §6：「守護者不可取得聊天原文，除非長者個別開啟 raw_chat_share。」
 * 拿不到 repository，就沒有任何一條路徑能不小心把原文洩出去 ——
 * 這比在回應裡逐欄位過濾可靠。
 *
 * life_signal.evidence 是唯一接近原句的欄位，只在 raw_chat_share 開啟時才附上。
 */
@Injectable()
export class GuardianViewService {
  constructor(
    @InjectRepository(Elder) private readonly elders: Repository<Elder>,
    @InjectRepository(GuardianLink) private readonly links: Repository<GuardianLink>,
    @InjectRepository(PatternAlert) private readonly alerts: Repository<PatternAlert>,
    @InjectRepository(AlertSignalLink) private readonly alertLinks: Repository<AlertSignalLink>,
    @InjectRepository(LifeSignal) private readonly signals: Repository<LifeSignal>,
    @InjectRepository(WeeklyDigest) private readonly digests: Repository<WeeklyDigest>,
    @InjectRepository(MedicalJourney) private readonly journeys: Repository<MedicalJourney>,
    private readonly baseline: BaselineService,
    private readonly consent: ConsentService,
  ) {}

  /** 守護者必須有未撤銷的綁定關係才能讀任何資料。 */
  async assertLinked(guardianId: string, elderId: string): Promise<void> {
    const link = await this.links.findOne({
      where: { guardianId, elderId, revokedAt: IsNull() },
    });
    if (!link) {
      throw new RawChatAccessDeniedError();
    }
  }

  /**
   * GET /v1/elders/:id/status — G-01 首頁。
   * 一個狀態、一句摘要、近期事件。受 consent 過濾（交接規格 §3）。
   */
  async status(guardianId: string, elderId: string, now = new Date()): Promise<ElderStatusView> {
    await this.assertLinked(guardianId, elderId);
    const elder = await this.elders.findOneByOrFail({ id: elderId });

    const gate = await this.baseline.gate(elderId, now);
    const latestAlert = await this.alerts.findOne({
      where: { elderId, internalOnly: false },
      order: { createdAt: 'DESC' },
    });

    let status: ElderStatusLabel;
    let summary: string;

    if (!gate.canDetect) {
      // 資料不足時只顯示「資料仍在建立」，不得輸出異常判斷（SRS F2-01）。
      status = 'insufficient_data';
      summary = `資料仍在建立中（有效生活日 ${gate.effectiveDays} / ${gate.requiredDays} 天）。這段期間不會做「跟平常不一樣」的判斷。`;
    } else if (latestAlert && this.isRecent(latestAlert.createdAt, now)) {
      status = 'worth_attention';
      summary = latestAlert.headline;
    } else {
      status = 'stable';
      summary = '最近的生活型態與平常大致一致。';
    }

    return {
      elderId,
      displayName: elder.displayName,
      status,
      summary,
      updatedAt: now.toISOString(),
      recentEvents: await this.recentEvents(elderId),
    };
  }

  /**
   * GET /v1/alerts/:id — G-03 變化詳情。
   * 含 baseline 對照與 supporting signals（交接規格 §3）。
   */
  async alertDetail(guardianId: string, alertId: string): Promise<AlertDetailView> {
    const alert = await this.alerts.findOneByOrFail({ id: alertId });
    await this.assertLinked(guardianId, alert.elderId);

    const snapshots = alert.baselineSnapshotId
      ? await this.baseline.latestSnapshot(alert.elderId)
      : [];

    const links = await this.alertLinks.find({ where: { alertId } });
    const signals = links.length
      ? await this.signals.findByIds(links.map((l) => l.signalId))
      : [];

    // 原句只在長者個別開啟 raw_chat_share 時才附上（交接規格 §6）。
    const canSeeRawChat = await this.consent.has(alert.elderId, 'raw_chat_share');

    return {
      id: alert.id,
      level: alert.level,
      headline: alert.headline,
      explanation: alert.explanation,
      createdAt: alert.createdAt.toISOString(),
      versions: {
        rule: alert.ruleVersion,
        model: alert.modelVersion,
        prompt: alert.promptVersion,
      },
      baselineSnapshotId: alert.baselineSnapshotId,
      comparison: await this.buildComparison(alert.elderId, alert.dimensions, snapshots),
      supportingSignals: signals.map((s) => ({
        dimension: s.dimension,
        occurredOn: s.occurredOn,
        confidence: s.confidence,
        ...(canSeeRawChat && s.evidence ? { quote: s.evidence } : {}),
      })),
    };
  }

  /** GET /v1/elders/:id/digest — G-02 週摘要與四維度對照。 */
  async digest(guardianId: string, elderId: string): Promise<WeeklyDigest | null> {
    await this.assertLinked(guardianId, elderId);
    return this.digests.findOne({ where: { elderId }, order: { weekStart: 'DESC' } });
  }

  /** G-04 醫療行程。只給完成狀態與必要摘要，不做全程定位（SRS F4-02）。 */
  async upcomingJourneys(guardianId: string, elderId: string): Promise<MedicalJourney[]> {
    await this.assertLinked(guardianId, elderId);
    return this.journeys
      .createQueryBuilder('j')
      .where('j.elder_id = :elderId', { elderId })
      .andWhere('j.visit_at >= now() - interval \'1 day\'')
      .orderBy('j.visit_at', 'ASC')
      .take(10)
      .getMany();
  }

  /** 近 7 天實際次數 vs 個人 Baseline 週均，供 G-03 對照圖。 */
  private async buildComparison(
    elderId: string,
    dimensions: SignalDimension[],
    snapshots: BaselineSnapshot[],
  ): Promise<AlertDetailView['comparison']> {
    const from = new Date();
    from.setDate(from.getDate() - 6);

    const rows: Array<{ dimension: SignalDimension; count: string }> = await this.signals
      .createQueryBuilder('s')
      .select('s.dimension', 'dimension')
      .addSelect('COUNT(*)', 'count')
      .where('s.elder_id = :elderId', { elderId })
      .andWhere('s.occurred_on >= :from', { from: from.toISOString().slice(0, 10) })
      .andWhere('s.dimension IN (:...dims)', { dims: dimensions })
      .groupBy('s.dimension')
      .getRawMany();
    const recent = new Map(rows.map((r) => [r.dimension, Number.parseInt(r.count, 10)]));

    return dimensions.map((dimension) => {
      const snapshot = snapshots.find((s) => s.dimension === dimension);
      return {
        dimension,
        label: DIMENSION_LABELS[dimension],
        recent: recent.get(dimension) ?? 0,
        baseline: snapshot ? Number((snapshot.mean * 7).toFixed(1)) : 0,
      };
    });
  }

  /**
   * 近期事件。來源是 pattern_alert 與 medical_journey，不是 message ——
   * 這是「守護者拿不到聊天原文」在資料來源層面的落實。
   */
  private async recentEvents(elderId: string): Promise<ElderStatusView['recentEvents']> {
    const alerts = await this.alerts.find({
      where: { elderId, internalOnly: false },
      order: { createdAt: 'DESC' },
      take: 3,
    });
    const journeys = await this.journeys.find({
      where: { elderId },
      order: { visitAt: 'DESC' },
      take: 2,
    });

    return [
      ...alerts.map((a) => ({
        when: a.createdAt.toISOString().slice(0, 10),
        text: a.headline,
        tag: a.level,
        alertId: a.id,
      })),
      ...journeys.map((j) => ({
        when: j.visitAt.toISOString().slice(0, 10),
        text: `${j.hospital} ${j.department ?? ''}`.trim(),
        tag: j.status,
      })),
    ].sort((a, b) => b.when.localeCompare(a.when));
  }

  private isRecent(at: Date, now: Date): boolean {
    return now.getTime() - at.getTime() < 7 * 24 * 60 * 60 * 1000;
  }
}
