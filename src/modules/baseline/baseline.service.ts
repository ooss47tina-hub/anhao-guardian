import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InsufficientBaselineError } from 'src/common/errors/product-rule.errors';
import { BaselineSnapshot, LifeSignal } from 'src/database/entities';
import { BASELINE_DIMENSIONS, SignalDimension } from 'src/domain/signal-dimension';

export interface BaselineGateResult {
  /** 是否可產生「跟平常不一樣」的判斷與家人通知。 */
  canDetect: boolean;
  effectiveDays: number;
  requiredDays: number;
}

export interface DimensionBaseline {
  dimension: SignalDimension;
  mean: number;
  stddev: number;
  sampleDays: number;
  dataCompleteness: number;
}

/**
 * Individual Baseline。以個人為單位，不與其他長者比較（SRS 1.3）。
 */
@Injectable()
export class BaselineService {
  constructor(
    @InjectRepository(LifeSignal)
    private readonly signals: Repository<LifeSignal>,
    @InjectRepository(BaselineSnapshot)
    private readonly snapshots: Repository<BaselineSnapshot>,
    private readonly config: ConfigService,
  ) {}

  private get windowDays(): number {
    return this.config.get<number>('rules.baselineWindowDays') ?? 28;
  }

  private get requiredEffectiveDays(): number {
    return this.config.get<number>('rules.baselineMinEffectiveDays') ?? 21;
  }

  /**
   * 有效生活日：視窗內有任何 life_signal 的不重複日數。
   * 不是「有聊天」就算 —— 只有實際萃取到訊號的日子才計入，
   * 否則 Baseline 會被空對話灌水（North Star 是有效生活天數，不是聊天次數）。
   */
  async effectiveLifeDays(elderId: string, asOf: Date): Promise<number> {
    const from = this.windowStart(asOf);
    const rows: Array<{ count: string }> = await this.signals
      .createQueryBuilder('s')
      .select('COUNT(DISTINCT s.occurred_on)', 'count')
      .where('s.elder_id = :elderId', { elderId })
      .andWhere('s.occurred_on >= :from', { from })
      .andWhere('s.occurred_on <= :to', { to: this.toDateString(asOf) })
      // 被人工判定為錯誤的訊號不算有效生活日，與 computeDimensions 的過濾一致。
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM signal_review r
           WHERE r.signal_id = s.id AND r.verdict = 'discarded')`,
      )
      .getRawMany();
    return Number.parseInt(rows[0]?.count ?? '0', 10);
  }

  /**
   * Baseline 門檻閘門。
   *
   * 交接規格 §4 pattern_detect：「有效生活日 < 21 天者只寫內部記錄，不通知家人」。
   *
   * SPEC-CONFLICT：SRS F2-01 寫「至少 21 天且至少 12 個有效生活日」，與此不同。
   * 預設採交接規格（較嚴格）。門檻值在 configuration.ts 的 rules.baselineMinEffectiveDays，
   * 產品確認後改設定即可，不需動這裡的邏輯。
   */
  async gate(elderId: string, asOf: Date): Promise<BaselineGateResult> {
    const effectiveDays = await this.effectiveLifeDays(elderId, asOf);
    const requiredDays = this.requiredEffectiveDays;
    return { canDetect: effectiveDays >= requiredDays, effectiveDays, requiredDays };
  }

  /** 未通過閘門時拋錯。用於「絕不該走到這裡」的呼叫端。 */
  async assertCanDetect(elderId: string, asOf: Date): Promise<void> {
    const result = await this.gate(elderId, asOf);
    if (!result.canDetect) {
      throw new InsufficientBaselineError(result.effectiveDays, result.requiredDays);
    }
  }

  /**
   * 重算分維度基線。每日 07:00 由 baseline_rebuild job 呼叫。
   *
   * 統計單位是「每日訊號次數」，mean 為視窗內日平均、stddev 為母體標準差。
   * 只算 SRS F2-01 指定的四個維度；其他維度仍儲存但不進 Baseline。
   */
  async computeDimensions(elderId: string, asOf: Date): Promise<DimensionBaseline[]> {
    const from = this.windowStart(asOf);
    const to = this.toDateString(asOf);

    const rows: Array<{ dimension: SignalDimension; occurred_on: string; count: string }> =
      await this.signals
        .createQueryBuilder('s')
        .select('s.dimension', 'dimension')
        .addSelect('s.occurred_on', 'occurred_on')
        .addSelect('COUNT(*)', 'count')
        .where('s.elder_id = :elderId', { elderId })
        .andWhere('s.occurred_on >= :from', { from })
        .andWhere('s.occurred_on <= :to', { to })
        .andWhere('s.dimension IN (:...dims)', { dims: BASELINE_DIMENSIONS })
        // 被人工判定為錯誤的訊號不進 Baseline。
        .andWhere(
          `NOT EXISTS (SELECT 1 FROM signal_review r
             WHERE r.signal_id = s.id AND r.verdict = 'discarded')`,
        )
        .groupBy('s.dimension')
        .addGroupBy('s.occurred_on')
        .getRawMany();

    return BASELINE_DIMENSIONS.map((dimension) => {
      const perDay = rows.filter((r) => r.dimension === dimension);
      const counts = perDay.map((r) => Number.parseInt(r.count, 10));
      const sampleDays = counts.length;

      // 沒訊號的日子計為 0，否則平均值會被高估。
      const filled = [...counts, ...Array(Math.max(0, this.windowDays - sampleDays)).fill(0)];
      const mean = filled.reduce((a, b) => a + b, 0) / filled.length;
      const variance = filled.reduce((acc, v) => acc + (v - mean) ** 2, 0) / filled.length;

      return {
        dimension,
        mean: Number(mean.toFixed(4)),
        stddev: Number(Math.sqrt(variance).toFixed(4)),
        sampleDays,
        dataCompleteness: Number((sampleDays / this.windowDays).toFixed(4)),
      };
    });
  }

  /**
   * 寫入每日快照。
   * ON CONFLICT DO NOTHING —— 快照永久保留供事後追溯，重跑不得覆寫（交接規格 §2.3）。
   */
  async writeSnapshot(elderId: string, asOf: Date): Promise<BaselineSnapshot[]> {
    const computedOn = this.toDateString(asOf);
    const dimensions = await this.computeDimensions(elderId, asOf);

    await this.snapshots
      .createQueryBuilder()
      .insert()
      .values(
        dimensions.map((d) => ({
          elderId,
          computedOn,
          windowDays: this.windowDays,
          dimension: d.dimension,
          mean: d.mean,
          stddev: d.stddev,
          sampleDays: d.sampleDays,
          dataCompleteness: d.dataCompleteness,
        })),
      )
      .orIgnore()
      .execute();

    return this.snapshots.find({ where: { elderId, computedOn } });
  }

  async latestSnapshot(elderId: string): Promise<BaselineSnapshot[]> {
    const latest = await this.snapshots.findOne({
      where: { elderId },
      order: { computedOn: 'DESC' },
    });
    if (!latest) return [];
    return this.snapshots.find({ where: { elderId, computedOn: latest.computedOn } });
  }

  private windowStart(asOf: Date): string {
    const start = new Date(asOf);
    start.setDate(start.getDate() - (this.windowDays - 1));
    return this.toDateString(start);
  }

  private toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
