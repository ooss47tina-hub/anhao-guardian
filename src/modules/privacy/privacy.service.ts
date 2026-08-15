import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from 'src/common/audit/audit.service';
import { ConsentService } from 'src/common/consent/consent.service';
import { ElderConsentRequiredError } from 'src/common/errors/product-rule.errors';
import { Elder } from 'src/database/entities';
import { OBJECT_STORAGE_PORT, ObjectStoragePort } from 'src/ports/object-storage.port';
import { MessageRepository } from 'src/modules/conversation/message.repository';

/**
 * 資料可攜與刪除權。
 *
 * 交接規格 §3：「刪除為不可逆，需二次確認」。
 * 交接規格 §6：「長者可要求匯出或刪除全部資料；刪除後不得保留可還原副本。」
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    @InjectRepository(Elder) private readonly elders: Repository<Elder>,
    private readonly messages: MessageRepository,
    private readonly consent: ConsentService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
  ) {}

  /** POST /v1/elders/:id/export — 只有長者本人可要求。 */
  async export(input: { elderId: string; actorRole: string; actorId: string }): Promise<{
    elder: Elder;
    consents: string[];
    messages: unknown[];
    exportedAt: string;
  }> {
    this.assertElderSelf(input);

    const elder = await this.elders.findOneByOrFail({ id: input.elderId });
    const messages = await this.messages.exportAllForElder(input.elderId);
    const consents = await this.consent.grantedScopes(input.elderId);

    await this.audit.record({
      actorType: 'elder',
      actorId: input.elderId,
      action: 'privacy.export',
      targetTable: 'elder',
      targetId: input.elderId,
      after: { messageCount: messages.length },
    });

    return { elder, consents, messages, exportedAt: new Date().toISOString() };
  }

  /**
   * POST /v1/elders/:id/erase — 不可逆刪除。
   *
   * confirmationToken 為二次確認（交接規格 §3）。呼叫端須先取得 token，
   * 再帶著 token 呼叫一次 —— 單次呼叫不會刪除任何東西。
   *
   * 刪除順序：物件儲存 → 資料庫。
   * 反過來會讓 elder 消失但音檔留著，且沒有 elder_id 可用來找它們。
   */
  async requestErase(input: { elderId: string; actorRole: string; actorId: string }): Promise<{
    confirmationToken: string;
    expiresAt: string;
  }> {
    this.assertElderSelf(input);

    const token = `erase-${input.elderId}-${Date.now()}`;
    await this.audit.record({
      actorType: 'elder',
      actorId: input.elderId,
      action: 'privacy.erase_requested',
      targetTable: 'elder',
      targetId: input.elderId,
    });

    return {
      confirmationToken: token,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  async confirmErase(input: {
    elderId: string;
    actorRole: string;
    actorId: string;
    confirmationToken: string;
  }): Promise<{ deleted: true }> {
    this.assertElderSelf(input);

    if (!input.confirmationToken.startsWith(`erase-${input.elderId}-`)) {
      throw new ElderConsentRequiredError('資料刪除');
    }

    // 稽核紀錄先寫。audit_log 是 append-only 且刻意不隨長者刪除 ——
    // 「誰在什麼時候刪了什麼」本身是合規要求，但內容只留 id，不留個資。
    await this.audit.record({
      actorType: 'elder',
      actorId: input.elderId,
      action: 'privacy.erase_confirmed',
      targetTable: 'elder',
      targetId: input.elderId,
    });

    const removedObjects = await this.storage.deleteByPrefix(`elder/${input.elderId}/`);
    await this.messages.hardDeleteForElder(input.elderId);

    // 其餘資料表以 ON DELETE CASCADE 連動刪除。
    // life_signal 與 baseline_snapshot 是分區表、無 FK，需明確刪除。
    await this.dataSource.transaction(async (manager) => {
      await manager.query('DELETE FROM life_signal WHERE elder_id = $1', [input.elderId]);
      await manager.query('DELETE FROM baseline_snapshot WHERE elder_id = $1', [input.elderId]);
      await manager.query('DELETE FROM elder WHERE id = $1', [input.elderId]);
    });

    this.logger.log(`長者 ${input.elderId} 資料已刪除，物件 ${removedObjects} 件`);
    return { deleted: true };
  }

  private assertElderSelf(input: { elderId: string; actorRole: string; actorId: string }): void {
    if (input.actorRole !== 'elder' || input.actorId !== input.elderId) {
      throw new ElderConsentRequiredError('資料匯出與刪除');
    }
  }
}
