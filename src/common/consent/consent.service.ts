import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from 'src/common/audit/audit.service';
import { ConsentScopeDeniedError, ElderConsentRequiredError } from 'src/common/errors/product-rule.errors';
import { VERSIONS } from 'src/common/versioning/versions';
import { Consent, ConsentScope, REQUIRED_CONSENT_SCOPES } from 'src/database/entities';

export type ActorRole = 'elder' | 'guardian' | 'admin' | 'system';

/**
 * 用途分層同意。
 *
 * 兩條不可讓步的規則（交接規格 §6）：
 * 1. 授權範圍一律由長者本人在 LINE 確認；守護者只能提出請求。
 * 2. consent 表 append-only —— 撤銷是插入新列，不是改舊列。
 */
@Injectable()
export class ConsentService {
  constructor(
    @InjectRepository(Consent)
    private readonly repo: Repository<Consent>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /**
   * 授予授權。只接受長者本人。
   * 守護者呼叫必定拋 ElderConsentRequiredError —— 這是產品原則，不是權限設定。
   */
  async grant(input: {
    elderId: string;
    scope: ConsentScope;
    actorRole: ActorRole;
    actorId: string;
    evidenceRef: string;
  }): Promise<Consent> {
    if (input.actorRole !== 'elder' || input.actorId !== input.elderId) {
      throw new ElderConsentRequiredError(input.scope);
    }

    const consent = await this.repo.save(
      this.repo.create({
        elderId: input.elderId,
        scope: input.scope,
        granted: true,
        consentVersion: VERSIONS.consent,
        grantedAt: new Date(),
        revokedAt: null,
        evidenceRef: input.evidenceRef,
      }),
    );

    await this.audit.record({
      actorType: 'elder',
      actorId: input.elderId,
      action: 'consent.grant',
      targetTable: 'consent',
      targetId: consent.id,
      after: { scope: input.scope, granted: true, version: VERSIONS.consent },
    });

    return consent;
  }

  /**
   * 撤銷授權。走 DB 函式插入新列，不 UPDATE 舊列。
   * consent 表的 append-only trigger 會擋掉任何 UPDATE 嘗試。
   */
  async revoke(input: {
    elderId: string;
    scope: ConsentScope;
    actorRole: ActorRole;
    actorId: string;
    evidenceRef: string;
  }): Promise<void> {
    if (input.actorRole !== 'elder' || input.actorId !== input.elderId) {
      throw new ElderConsentRequiredError(input.scope);
    }

    await this.dataSource.query('SELECT revoke_consent($1, $2, $3, $4)', [
      input.elderId,
      input.scope,
      VERSIONS.consent,
      input.evidenceRef,
    ]);

    await this.audit.record({
      actorType: 'elder',
      actorId: input.elderId,
      action: 'consent.revoke',
      targetTable: 'consent',
      targetId: input.elderId,
      after: { scope: input.scope, granted: false },
    });
  }

  /** 目前狀態＝該 scope 最新一筆的 granted 值。 */
  async has(elderId: string, scope: ConsentScope): Promise<boolean> {
    const latest = await this.repo.findOne({
      where: { elderId, scope },
      order: { grantedAt: 'DESC' },
    });
    return latest?.granted === true;
  }

  async require(elderId: string, scope: ConsentScope): Promise<void> {
    if (!(await this.has(elderId, scope))) {
      throw new ConsentScopeDeniedError(scope);
    }
  }

  /** 目前所有已開啟的 scope，供守護者端顯示「我可以看到什麼」。 */
  async grantedScopes(elderId: string): Promise<ConsentScope[]> {
    const rows = await this.repo.find({ where: { elderId }, order: { grantedAt: 'ASC' } });
    const state = new Map<ConsentScope, boolean>();
    for (const row of rows) state.set(row.scope, row.granted);
    return [...state.entries()].filter(([, granted]) => granted).map(([scope]) => scope);
  }

  /** 必要項目未開就無法使用（介面原型 M1）。 */
  async canUseService(elderId: string): Promise<boolean> {
    const granted = await this.grantedScopes(elderId);
    return REQUIRED_CONSENT_SCOPES.every((scope) => granted.includes(scope));
  }
}
