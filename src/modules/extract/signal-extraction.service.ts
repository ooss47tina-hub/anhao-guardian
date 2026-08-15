import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from 'src/common/audit/audit.service';
import { VERSIONS } from 'src/common/versioning/versions';
import { LifeSignal, ReviewState, SignalReview, ReviewVerdict } from 'src/database/entities';
import { ExtractedSignal } from 'src/ports/llm.port';

/**
 * Life Signal 萃取結果的落地與人工抽查佇列。
 *
 * 交接規格 §1 Extract：「LLM 將語句轉為結構化 Life Signal，附信心值；
 * 低於門檻進人工佇列。」
 */
@Injectable()
export class SignalExtractionService {
  constructor(
    @InjectRepository(LifeSignal) private readonly signals: Repository<LifeSignal>,
    @InjectRepository(SignalReview) private readonly reviews: Repository<SignalReview>,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private get threshold(): number {
    return this.config.get<number>('rules.signalReviewConfidenceThreshold') ?? 0.7;
  }

  /**
   * 寫入萃取結果。
   * 低於信心門檻者標 pending_review 進佇列，但仍然寫入 ——
   * 丟掉低信心訊號會讓 Baseline 的資料完整度失真。
   */
  async persist(input: {
    elderId: string;
    messageId: string | null;
    signals: ExtractedSignal[];
  }): Promise<LifeSignal[]> {
    if (input.signals.length === 0) return [];

    const rows = input.signals.map((s) =>
      this.signals.create({
        elderId: input.elderId,
        messageId: input.messageId,
        dimension: s.dimension,
        value: s.value,
        confidence: s.confidence,
        extractorVersion: VERSIONS.extractor,
        occurredOn: s.occurredOn,
        evidence: s.evidence,
        reviewState: (s.confidence < this.threshold
          ? 'pending_review'
          : 'auto_accepted') as ReviewState,
      }),
    );

    return this.signals.save(rows);
  }

  /** GET /admin/review/queue — 低信心訊號抽查佇列（交接規格 §3）。 */
  async reviewQueue(limit = 50): Promise<LifeSignal[]> {
    return this.signals.find({
      where: { reviewState: 'pending_review' },
      order: { confidence: 'ASC' },
      take: limit,
    });
  }

  /**
   * POST /admin/review/:signalId — 正確／修正，寫 signal_review 與 audit_log。
   * 修正結果保留 reviewer 與時間，回饋 extractor 訓練集（SRS 第 5 節）。
   */
  async review(input: {
    signalId: string;
    reviewerId: string;
    verdict: ReviewVerdict;
    correctedValue?: string;
  }): Promise<SignalReview> {
    const signal = await this.signals.findOneByOrFail({ id: input.signalId });

    const review = await this.reviews.save(
      this.reviews.create({
        signalId: input.signalId,
        reviewerId: input.reviewerId,
        verdict: input.verdict,
        correctedValue: input.correctedValue ?? null,
        reviewedAt: new Date(),
      }),
    );

    await this.signals.update({ id: input.signalId }, { reviewState: 'reviewed' });

    await this.audit.record({
      actorType: 'admin',
      actorId: input.reviewerId,
      action: 'signal.review',
      targetTable: 'life_signal',
      targetId: input.signalId,
      before: { value: signal.value, confidence: signal.confidence },
      after: { verdict: input.verdict, correctedValue: input.correctedValue ?? null },
    });

    return review;
  }

  /**
   * 品質指標：Signal Precision。
   * SRS 第 2 節驗收要求 ≥ 85%。discarded 視為錯誤，corrected 也算錯誤 ——
   * 只有 correct 才計入正確，避免把「勉強可用」灌進分子。
   */
  async signalPrecision(): Promise<{ reviewed: number; correct: number; precision: number }> {
    const rows: Array<{ verdict: ReviewVerdict; count: string }> = await this.reviews
      .createQueryBuilder('r')
      .select('r.verdict', 'verdict')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.verdict')
      .getRawMany();

    const counts = new Map(rows.map((r) => [r.verdict, Number.parseInt(r.count, 10)]));
    const reviewed = [...counts.values()].reduce((a, b) => a + b, 0);
    const correct = counts.get('correct') ?? 0;
    return {
      reviewed,
      correct,
      precision: reviewed === 0 ? 0 : Number((correct / reviewed).toFixed(4)),
    };
  }
}
