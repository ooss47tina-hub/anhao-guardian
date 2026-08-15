import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiagnosticLanguageFilter } from 'src/common/safety/diagnostic-language.filter';
import { currentVersionSet } from 'src/common/versioning/versions';
import { AlertSignalLink, BaselineSnapshot, LifeSignal, PatternAlert } from 'src/database/entities';
import { AlertLevel, BASELINE_DIMENSIONS, DIMENSION_LABELS, SignalDimension } from 'src/domain/signal-dimension';
import { LLM_PORT, LlmPort } from 'src/ports/llm.port';
import { BaselineService } from 'src/modules/baseline/baseline.service';

/** 近 7 天為比較視窗（介面原型 G-03「近 7 天外出變少」）。 */
const RECENT_WINDOW_DAYS = 7;

/**
 * 偏離判定門檻。
 * 近 7 天的日平均低於 Baseline 平均的此比例即視為偏離。
 * 用比例而非標準差的理由：長者的訊號次數是小整數，stddev 常接近 0，
 * z-score 會在正常波動時就爆掉。stddev 仍寫入快照供事後分析。
 */
const DEVIATION_RATIO = 0.5;

export interface Deviation {
  dimension: SignalDimension;
  recent: number;
  baseline: number;
}

export interface DetectionResult {
  level: AlertLevel;
  deviations: Deviation[];
  /** true 代表只寫內部記錄、不通知家人。 */
  internalOnly: boolean;
  alertId: string | null;
  reason: string;
}

/**
 * Pattern Change Detection。
 *
 * SRS F2-02：「P2 不能由 LLM 單獨自由判斷；需規則／統計特徵 + LLM 語意訊號共同產生。」
 * 所以分級一律由這裡的規則決定，LLM 只負責把已定案的判斷寫成人看得懂的句子。
 */
@Injectable()
export class PatternEngineService {
  private readonly logger = new Logger(PatternEngineService.name);

  constructor(
    @InjectRepository(LifeSignal) private readonly signals: Repository<LifeSignal>,
    @InjectRepository(PatternAlert) private readonly alerts: Repository<PatternAlert>,
    @InjectRepository(AlertSignalLink) private readonly links: Repository<AlertSignalLink>,
    private readonly baseline: BaselineService,
    private readonly diagnosticFilter: DiagnosticLanguageFilter,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
  ) {}

  /**
   * 每日 07:30 對單一長者執行。
   *
   * 交接規格 §4：「有效生活日 < 21 天者只寫內部記錄，不通知家人」。
   * 這裡的處理是仍然計算並寫入 alert，但 internal_only = true，
   * 通知層據此不推播。保留內部記錄是為了事後能回答「那時候系統看到什麼」。
   */
  async detect(elderId: string, asOf: Date): Promise<DetectionResult> {
    const gate = await this.baseline.gate(elderId, asOf);
    const snapshots = await this.baseline.latestSnapshot(elderId);

    if (snapshots.length === 0) {
      return {
        level: 'P1',
        deviations: [],
        internalOnly: true,
        alertId: null,
        reason: '尚無 baseline 快照，資料仍在建立',
      };
    }

    const deviations = await this.findDeviations(elderId, asOf, snapshots);
    const level = this.classify(deviations);

    // 資料不足時一律降級為內部記錄，不論偏離多明顯。
    const internalOnly = !gate.canDetect || level === 'P0' || level === 'P1';

    if (level === 'P0') {
      return {
        level,
        deviations,
        internalOnly: true,
        alertId: null,
        reason: '落在個人 Baseline 正常範圍',
      };
    }

    const alert = await this.writeAlert({
      elderId,
      level,
      deviations,
      snapshotId: snapshots[0].id,
      internalOnly,
    });

    return {
      level,
      deviations,
      internalOnly,
      alertId: alert.id,
      reason: internalOnly
        ? `有效生活日 ${gate.effectiveDays} 天未達 ${gate.requiredDays} 天，只寫內部記錄`
        : `${deviations.length} 個維度持續偏離`,
    };
  }

  /**
   * 分級規則（SRS F2-02）。
   * P3 不在這裡產生 —— 高風險語句走 SafetyRuleService，不等 Pattern Engine。
   */
  private classify(deviations: Deviation[]): AlertLevel {
    if (deviations.length === 0) return 'P0';
    if (deviations.length >= 2) return 'P2';

    // 單一維度：顯著且持續才升 P2，否則只是觀察。
    const only = deviations[0];
    const significant = only.baseline > 0 && only.recent <= only.baseline * 0.25;
    return significant ? 'P2' : 'P1';
  }

  private async findDeviations(
    elderId: string,
    asOf: Date,
    snapshots: BaselineSnapshot[],
  ): Promise<Deviation[]> {
    const from = new Date(asOf);
    from.setDate(from.getDate() - (RECENT_WINDOW_DAYS - 1));

    const rows: Array<{ dimension: SignalDimension; count: string }> = await this.signals
      .createQueryBuilder('s')
      .select('s.dimension', 'dimension')
      .addSelect('COUNT(*)', 'count')
      .where('s.elder_id = :elderId', { elderId })
      .andWhere('s.occurred_on >= :from', { from: from.toISOString().slice(0, 10) })
      .andWhere('s.occurred_on <= :to', { to: asOf.toISOString().slice(0, 10) })
      .andWhere('s.dimension IN (:...dims)', { dims: BASELINE_DIMENSIONS })
      .groupBy('s.dimension')
      .getRawMany();

    const recentByDimension = new Map(
      rows.map((r) => [r.dimension, Number.parseInt(r.count, 10) / RECENT_WINDOW_DAYS]),
    );

    const deviations: Deviation[] = [];
    for (const snapshot of snapshots) {
      if (!BASELINE_DIMENSIONS.includes(snapshot.dimension)) continue;

      const recentDaily = recentByDimension.get(snapshot.dimension) ?? 0;
      // Baseline 本身接近 0 的維度沒有「變少」可言，跳過避免誤報。
      if (snapshot.mean < 0.1) continue;

      if (recentDaily <= snapshot.mean * DEVIATION_RATIO) {
        deviations.push({
          dimension: snapshot.dimension,
          // 對外一律用「每週次數」表達，與介面原型的措辭一致。
          recent: Number((recentDaily * 7).toFixed(1)),
          baseline: Number((snapshot.mean * 7).toFixed(1)),
        });
      }
    }
    return deviations;
  }

  private async writeAlert(input: {
    elderId: string;
    level: AlertLevel;
    deviations: Deviation[];
    snapshotId: string;
    internalOnly: boolean;
  }): Promise<PatternAlert> {
    const supporting = await this.collectSupportingSignals(input.elderId, input.deviations);

    const explanation = await this.llm.explainPattern({
      deviations: input.deviations,
      supportingQuotes: supporting.map((s) => s.evidence ?? '').filter(Boolean),
    });

    // LLM 輸出不可信。寫入前一律過濾（交接規格 §6）。
    this.diagnosticFilter.assertClean(explanation);

    const headline = this.buildHeadline(input.deviations);
    this.diagnosticFilter.assertClean(headline);

    const versions = currentVersionSet();
    const alert = await this.alerts.save(
      this.alerts.create({
        elderId: input.elderId,
        level: input.level,
        dimensions: input.deviations.map((d) => d.dimension),
        headline,
        explanation,
        baselineSnapshotId: input.snapshotId,
        ruleVersion: versions.ruleVersion,
        modelVersion: versions.modelVersion,
        promptVersion: versions.promptVersion,
        internalOnly: input.internalOnly,
      }),
    );

    if (supporting.length > 0) {
      await this.links.insert(
        supporting.map((s) => ({ alertId: alert.id, signalId: s.id, weight: 1 })),
      );
    }

    this.logger.log(
      `alert ${alert.id} level=${input.level} internalOnly=${input.internalOnly} ` +
        `dimensions=${input.deviations.map((d) => d.dimension).join(',')}`,
    );
    return alert;
  }

  /** 支撐「為什麼這樣判斷」的證據清單（交接規格 §2.3 alert_signal_link）。 */
  private async collectSupportingSignals(
    elderId: string,
    deviations: Deviation[],
  ): Promise<LifeSignal[]> {
    if (deviations.length === 0) return [];
    return this.signals.find({
      where: deviations.map((d) => ({ elderId, dimension: d.dimension })),
      order: { occurredOn: 'DESC' },
      take: 20,
    });
  }

  /** 措辭遵循 SRS 8.3：用「值得關心」而非「異常」，不用恐嚇式紅色警示。 */
  private buildHeadline(deviations: Deviation[]): string {
    const labels = deviations.map((d) => DIMENSION_LABELS[d.dimension]);
    return `近 ${RECENT_WINDOW_DAYS} 天${labels.join('、')}比平常少`;
  }
}
