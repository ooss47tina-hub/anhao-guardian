import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ConsentService } from 'src/common/consent/consent.service';
import { DiagnosticLanguageFilter } from 'src/common/safety/diagnostic-language.filter';
import {
  Guardian,
  GuardianLink,
  LifeSignal,
  MedicalJourney,
  Notification,
  WeeklyDigest,
} from 'src/database/entities';
import { BASELINE_DIMENSIONS, SignalDimension } from 'src/domain/signal-dimension';
import { LLM_PORT, LlmPort } from 'src/ports/llm.port';
import { LINE_PORT, LinePort } from 'src/ports/line.port';
import { BaselineService } from 'src/modules/baseline/baseline.service';

/**
 * Weekly Family Digest（交接規格 §2.3、§4；SRS F3-02）。
 *
 * 週一 09:00 產生。內容不含聊天原文 —— 資料來源只有 baseline_snapshot、
 * life_signal 的聚合數字與 medical_journey，完全不碰 message。
 */
@Injectable()
export class DigestService {
  constructor(
    @InjectRepository(WeeklyDigest) private readonly digests: Repository<WeeklyDigest>,
    @InjectRepository(GuardianLink) private readonly links: Repository<GuardianLink>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(MedicalJourney) private readonly journeys: Repository<MedicalJourney>,
    @InjectRepository(LifeSignal) private readonly signals: Repository<LifeSignal>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    private readonly baseline: BaselineService,
    private readonly consent: ConsentService,
    private readonly diagnosticFilter: DiagnosticLanguageFilter,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    @Inject(LINE_PORT) private readonly line: LinePort,
  ) {}

  async build(elderId: string, weekStart: Date): Promise<WeeklyDigest> {
    const snapshots = await this.baseline.latestSnapshot(elderId);
    const gate = await this.baseline.gate(elderId, weekStart);

    // 摘要週：weekStart（週一）往前推七天，即剛結束的那一週。
    const weekFrom = new Date(weekStart);
    weekFrom.setDate(weekFrom.getDate() - 7);

    const rows: Array<{ dimension: SignalDimension; count: string }> = await this.signals
      .createQueryBuilder('s')
      .select('s.dimension', 'dimension')
      .addSelect('COUNT(*)', 'count')
      .where('s.elder_id = :elderId', { elderId })
      .andWhere('s.occurred_on >= :from', { from: weekFrom.toISOString().slice(0, 10) })
      .andWhere('s.occurred_on < :to', { to: weekStart.toISOString().slice(0, 10) })
      .andWhere('s.dimension IN (:...dims)', { dims: BASELINE_DIMENSIONS })
      .groupBy('s.dimension')
      .getRawMany();

    const recentByDimension = new Map(rows.map((r) => [r.dimension, Number.parseInt(r.count, 10)]));

    const dimensionSummary = BASELINE_DIMENSIONS.map((dimension: SignalDimension) => {
      const snapshot = snapshots.find((s) => s.dimension === dimension);
      return {
        dimension,
        recent: recentByDimension.get(dimension) ?? 0,
        baseline: snapshot ? Number((snapshot.mean * 7).toFixed(1)) : 0,
      };
    });

    const upcoming = await this.journeys
      .createQueryBuilder('j')
      .where('j.elder_id = :elderId', { elderId })
      .andWhere('j.visit_at >= :from', { from: weekStart })
      .orderBy('j.visit_at', 'ASC')
      .take(3)
      .getMany();

    // 資料不足時不得輸出「跟平常不一樣」的判斷（交接規格 §6）。
    // 偏離門檻與 Pattern Engine 一致（低於平常一半才算變化），
    // 避免正常波動讓「全週穩定」的極短摘要永遠出不來。
    const stable =
      !gate.canDetect ||
      dimensionSummary.every((d) => d.baseline < 0.1 || d.recent > d.baseline * 0.5);

    const composed = await this.llm.composeDigest({
      dimensionSummary,
      upcomingTasks: upcoming.map(
        (j) => `${j.visitAt.toISOString().slice(0, 10)} ${j.hospital}${j.department ?? ''}`,
      ),
      stable,
    });

    this.diagnosticFilter.assertClean(composed.headline);
    this.diagnosticFilter.assertClean(composed.body);

    const weekStartDate = weekStart.toISOString().slice(0, 10);
    const existing = await this.digests.findOne({ where: { elderId, weekStart: weekStartDate } });

    return this.digests.save({
      ...(existing ?? {}),
      elderId,
      weekStart: weekStartDate,
      headline: gate.canDetect ? composed.headline : '資料仍在建立中',
      body: gate.canDetect
        ? composed.body
        : `有效生活日 ${gate.effectiveDays} / ${gate.requiredDays} 天。這段期間我們不會做「跟平常不一樣」的判斷。`,
      dimensionSummary,
    } as WeeklyDigest);
  }

  /**
   * 推送週摘要。
   * 週摘要屬「明確待辦以外」的例行通知，仍需 pattern_share 授權。
   */
  async send(digest: WeeklyDigest, now = new Date()): Promise<Notification | null> {
    const link = await this.links.findOne({
      where: { elderId: digest.elderId, isPrimary: true, revokedAt: IsNull() },
    });
    if (!link) return null;

    const allowed = await this.consent.has(digest.elderId, 'pattern_share');
    if (!allowed) {
      return this.notifications.save(
        this.notifications.create({
          recipientType: 'guardian',
          recipientId: link.guardianId,
          kind: 'weekly_digest',
          payload: { digestId: digest.id },
          sentAt: null,
          suppressedReason: 'consent_pattern_share_missing',
        }),
      );
    }

    const guardian = await this.guardians.findOneByOrFail({ id: link.guardianId });
    await this.line.push({
      lineUserId: guardian.lineUserId,
      text: `${digest.headline}\n${digest.body}`,
    });

    digest.sentAt = now;
    await this.digests.save(digest);

    return this.notifications.save(
      this.notifications.create({
        recipientType: 'guardian',
        recipientId: link.guardianId,
        kind: 'weekly_digest',
        payload: { digestId: digest.id },
        sentAt: now,
        suppressedReason: null,
      }),
    );
  }
}
