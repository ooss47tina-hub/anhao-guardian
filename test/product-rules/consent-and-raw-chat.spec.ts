import { ElderConsentRequiredError } from 'src/common/errors/product-rule.errors';
import { ConsentService } from 'src/common/consent/consent.service';

/**
 * 交接規格 §6：
 * - 「授權範圍一律由長者本人在 LINE 確認；守護者只能提出請求。」
 * - 「守護者不可取得聊天原文，除非長者個別開啟 raw_chat_share。」
 */
describe('產品原則：授權由長者本人確認', () => {
  function buildService(rows: Array<{ scope: string; granted: boolean; grantedAt: Date }> = []) {
    const repo = {
      create: (x: unknown) => x,
      save: jest.fn(async (x: unknown) => ({ ...(x as object), id: 'consent-1' })),
      findOne: jest.fn(async ({ where }: { where: { scope: string } }) => {
        const matching = rows
          .filter((r) => r.scope === where.scope)
          .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());
        return matching[0] ?? null;
      }),
      find: jest.fn(async () => [...rows].sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime())),
    };
    const dataSource = { query: jest.fn(async () => [{}]) };
    const audit = { record: jest.fn() };
    return {
      service: new ConsentService(repo as never, dataSource as never, audit as never),
      repo,
      dataSource,
    };
  }

  it('守護者不能代長者授權', async () => {
    const { service, repo } = buildService();

    await expect(
      service.grant({
        elderId: 'elder-1',
        scope: 'raw_chat_share',
        actorRole: 'guardian',
        actorId: 'guardian-1',
        evidenceRef: 'liff-event-1',
      }),
    ).rejects.toBeInstanceOf(ElderConsentRequiredError);

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('長者不能代另一位長者授權', async () => {
    const { service } = buildService();

    await expect(
      service.grant({
        elderId: 'elder-1',
        scope: 'medical',
        actorRole: 'elder',
        actorId: 'elder-2',
        evidenceRef: 'line-message-1',
      }),
    ).rejects.toBeInstanceOf(ElderConsentRequiredError);
  });

  it('長者本人可授權', async () => {
    const { service, repo } = buildService();

    await service.grant({
      elderId: 'elder-1',
      scope: 'medical',
      actorRole: 'elder',
      actorId: 'elder-1',
      evidenceRef: 'line-message-1',
    });

    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('撤銷走 revoke_consent 函式插入新列，不 UPDATE 舊列', async () => {
    const { service, dataSource, repo } = buildService();

    await service.revoke({
      elderId: 'elder-1',
      scope: 'raw_chat_share',
      actorRole: 'elder',
      actorId: 'elder-1',
      evidenceRef: 'line-message-2',
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      'SELECT revoke_consent($1, $2, $3, $4)',
      expect.arrayContaining(['elder-1', 'raw_chat_share']),
    );
    // append-only：撤銷不得經由 repository 改寫既有紀錄。
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('預設未開啟 raw_chat_share', async () => {
    const { service } = buildService([
      { scope: 'core', granted: true, grantedAt: new Date('2026-08-01') },
      { scope: 'pattern_share', granted: true, grantedAt: new Date('2026-08-01') },
    ]);

    expect(await service.has('elder-1', 'raw_chat_share')).toBe(false);
    expect(await service.grantedScopes('elder-1')).not.toContain('raw_chat_share');
  });

  it('最新一筆決定目前狀態：授權後撤銷即為關閉', async () => {
    const { service } = buildService([
      { scope: 'raw_chat_share', granted: true, grantedAt: new Date('2026-08-01') },
      { scope: 'raw_chat_share', granted: false, grantedAt: new Date('2026-08-10') },
    ]);

    expect(await service.has('elder-1', 'raw_chat_share')).toBe(false);
  });

  it('必要項目（core）未開時不可使用服務', async () => {
    const { service } = buildService([
      { scope: 'pattern_share', granted: true, grantedAt: new Date('2026-08-01') },
    ]);

    expect(await service.canUseService('elder-1')).toBe(false);
  });
});
