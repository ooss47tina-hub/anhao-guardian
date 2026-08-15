import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AuditService } from 'src/common/audit/audit.service';
import { HumanReviewRequiredError } from 'src/common/errors/product-rule.errors';
import { MedicationItem, Notification } from 'src/database/entities';
import { OCR_PORT, OcrPort } from 'src/ports/ocr.port';

/**
 * 藥品項目與用藥提醒。
 *
 * 交接規格 §2.4 與 §6：「藥名與劑量未經人工確認不可建立用藥提醒。」
 * SRS F4-03 同。這是本系統風險最高的一條 —— 錯誤的用藥提醒會直接造成傷害。
 */
@Injectable()
export class MedicationService {
  constructor(
    @InjectRepository(MedicationItem) private readonly items: Repository<MedicationItem>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    private readonly audit: AuditService,
    @Inject(OCR_PORT) private readonly ocr: OcrPort,
  ) {}

  /**
   * POST /v1/ocr/medical — 藥袋／回診單辨識。
   * 辨識結果一律 needs_human_review，OCR 端無法產生已驗證的項目。
   */
  async ingestFromPhoto(input: {
    elderId: string;
    journeyId: string | null;
    imageRef: string;
    mimeType: string;
  }): Promise<{ items: MedicationItem[]; nextVisitAt: string | null }> {
    const result = await this.ocr.readMedicalDocument({
      ref: input.imageRef,
      mimeType: input.mimeType,
    });

    const items = await this.items.save(
      result.medications.map((m) =>
        this.items.create({
          elderId: input.elderId,
          journeyId: input.journeyId,
          ocrRaw: m.ocrRaw,
          drugName: m.guessedDrugName,
          dosage: m.guessedDosage,
          // 明確寫 null：OCR 結果永遠不算人工確認。
          humanVerifiedBy: null,
          verifiedAt: null,
        }),
      ),
    );

    await this.audit.record({
      actorType: 'system',
      action: 'medication.ocr_ingest',
      targetTable: 'medication_item',
      targetId: input.elderId,
      after: { count: items.length, confidence: result.confidence },
    });

    return { items, nextVisitAt: result.nextVisitAt };
  }

  /** 人工確認。只有走這裡才能讓項目變成可用於提醒。 */
  async verify(input: {
    itemId: string;
    reviewerId: string;
    drugName: string;
    dosage: string;
  }): Promise<MedicationItem> {
    const item = await this.items.findOneByOrFail({ id: input.itemId });
    const before = { drugName: item.drugName, dosage: item.dosage };

    item.drugName = input.drugName;
    item.dosage = input.dosage;
    item.humanVerifiedBy = input.reviewerId;
    item.verifiedAt = new Date();
    const saved = await this.items.save(item);

    await this.audit.record({
      actorType: 'admin',
      actorId: input.reviewerId,
      action: 'medication.verify',
      targetTable: 'medication_item',
      targetId: input.itemId,
      before,
      after: { drugName: input.drugName, dosage: input.dosage },
    });

    return saved;
  }

  /**
   * 建立用藥提醒。
   *
   * 未經人工確認一律拋 HumanReviewRequiredError。
   * 這個檢查不可加旁路參數、不可在測試環境略過 —— 一旦有旁路，
   * 正式環境遲早會有人用它。
   */
  async createReminder(input: {
    itemId: string;
    elderId: string;
    scheduledAt: Date;
  }): Promise<Notification> {
    const item = await this.items.findOneByOrFail({ id: input.itemId, elderId: input.elderId });

    if (!item.humanVerifiedBy || !item.verifiedAt) {
      throw new HumanReviewRequiredError(`藥品「${item.drugName ?? item.ocrRaw}」`);
    }

    return this.notifications.save(
      this.notifications.create({
        recipientType: 'elder',
        recipientId: input.elderId,
        kind: 'medical_reminder',
        payload: {
          medicationItemId: item.id,
          drugName: item.drugName,
          dosage: item.dosage,
          scheduledAt: input.scheduledAt.toISOString(),
        },
        sentAt: null,
        suppressedReason: null,
      }),
    );
  }

  /**
   * 待人工確認的項目數，供守護者端顯示「共 N 項待人工確認」。
   * 用 IsNull() 而非 undefined —— TypeORM 會把 undefined 當作「不加條件」，
   * 結果會回傳全部項目而不是待確認的。
   */
  async pendingCount(elderId: string): Promise<number> {
    return this.items.count({ where: { elderId, humanVerifiedBy: IsNull() } });
  }

  /**
   * 待人工確認的項目清單，供營運後台覆核。
   *
   * 最舊的排前面 —— 這是佇列不是列表，先進來的先處理。
   * 同樣用 IsNull()：TypeORM 會把 undefined 當作「不加條件」，
   * 結果會回傳全部項目而不是待確認的。
   */
  async pendingItems(): Promise<MedicationItem[]> {
    return this.items.find({
      where: { humanVerifiedBy: IsNull() },
      order: { createdAt: 'ASC' },
    });
  }
}
