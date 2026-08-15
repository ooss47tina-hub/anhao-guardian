import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from 'src/common/audit/audit.service';
import { MemoryItem } from 'src/database/entities';
import { MemoryCandidate } from 'src/ports/llm.port';

/**
 * AI Memory / Life Timeline。
 *
 * 交接規格 §2.2：「未經長者確認（confirmed_by_elder = false）不得用於主動提醒。」
 * 這條由 forProactiveUse() 單點強制 —— 主動提醒的組裝路徑只准走這個方法。
 */
@Injectable()
export class MemoryService {
  constructor(
    @InjectRepository(MemoryItem) private readonly repo: Repository<MemoryItem>,
    private readonly audit: AuditService,
  ) {}

  /**
   * 收錄候選記憶。一律以未確認狀態寫入。
   * 高影響記憶（醫院、固定回診、緊急聯絡人）需長者確認（SRS F1-02）——
   * 這裡不提供「直接建立已確認記憶」的路徑。
   */
  async proposeMany(input: {
    elderId: string;
    sourceMessageId: string | null;
    candidates: MemoryCandidate[];
  }): Promise<MemoryItem[]> {
    if (input.candidates.length === 0) return [];
    return this.repo.save(
      input.candidates.map((c) =>
        this.repo.create({
          elderId: input.elderId,
          kind: c.kind,
          content: c.content,
          sourceMessageId: input.sourceMessageId,
          confidence: c.confidence,
          confirmedByElder: false,
          confirmedAt: null,
        }),
      ),
    );
  }

  /** 長者在 E-03 卡片按「對，記下來」。 */
  async confirm(memoryId: string, elderId: string): Promise<MemoryItem> {
    const item = await this.repo.findOneByOrFail({ id: memoryId, elderId });
    item.confirmedByElder = true;
    item.confirmedAt = new Date();
    const saved = await this.repo.save(item);

    await this.audit.record({
      actorType: 'elder',
      actorId: elderId,
      action: 'memory.confirm',
      targetTable: 'memory_item',
      targetId: memoryId,
      after: { confirmedByElder: true },
    });
    return saved;
  }

  /** 長者按「不用了」。標記失效而非刪除，供 extractor 回饋。 */
  async reject(memoryId: string, elderId: string): Promise<void> {
    await this.repo.update({ id: memoryId, elderId }, { validTo: new Date() });
    await this.audit.record({
      actorType: 'elder',
      actorId: elderId,
      action: 'memory.reject',
      targetTable: 'memory_item',
      targetId: memoryId,
    });
  }

  /**
   * 可用於主動提醒的記憶。
   *
   * 唯一允許組裝主動提醒內容的來源。任何繞過這個方法直接查 memory_item
   * 的程式碼都違反交接規格 §2.2。
   */
  async forProactiveUse(elderId: string): Promise<MemoryItem[]> {
    return this.repo
      .createQueryBuilder('m')
      .where('m.elder_id = :elderId', { elderId })
      .andWhere('m.confirmed_by_elder = true')
      .andWhere('(m.valid_to IS NULL OR m.valid_to > now())')
      .orderBy('m.confirmed_at', 'DESC')
      .getMany();
  }

  /**
   * 對話時可參考的記憶。
   * SRS F1-02：「AI 僅使用已確認或高信心資料回答。」
   * 高信心（≥ 0.85）的未確認記憶可用於「回話」，但不可用於「主動提醒」——
   * 兩者風險不同：回錯話長者會當場糾正，提醒錯了長者可能真的照做。
   */
  async forConversation(elderId: string): Promise<MemoryItem[]> {
    return this.repo
      .createQueryBuilder('m')
      .where('m.elder_id = :elderId', { elderId })
      .andWhere('(m.confirmed_by_elder = true OR m.confidence >= 0.85)')
      .andWhere('(m.valid_to IS NULL OR m.valid_to > now())')
      .orderBy('m.created_at', 'DESC')
      .take(20)
      .getMany();
  }

  /** 待長者確認的高影響記憶，供 E-03 卡片列出。 */
  async pendingConfirmation(elderId: string): Promise<MemoryItem[]> {
    return this.repo.find({
      where: { elderId, confirmedByElder: false },
      order: { createdAt: 'DESC' },
    });
  }
}
