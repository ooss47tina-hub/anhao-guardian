import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditActorType, AuditLog } from 'src/database/entities';

export interface AuditEntry {
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  targetTable: string;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * append-only 稽核。
 *
 * 交接規格 §2.4：「授權變更、人工修正、資料匯出與刪除皆需記錄」。
 * 這個 service 只有 record 與查詢，沒有 update / delete —— DB trigger 也會擋，
 * 但介面上就不提供，才不會有人以為可以改。
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    // 用 save 而非 insert：jsonb 欄位（before / after）在 insert 的
    // QueryDeepPartialEntity 型別下會與 Record<string, unknown> 衝突。
    await this.repo.save(
      this.repo.create({
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetTable: entry.targetTable,
        targetId: entry.targetId ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
      }),
    );
  }

  /** 資料可攜用。回傳該長者相關的全部稽核紀錄。 */
  async findByTarget(targetTable: string, targetId: string): Promise<AuditLog[]> {
    return this.repo.find({ where: { targetTable, targetId }, order: { at: 'DESC' } });
  }
}
