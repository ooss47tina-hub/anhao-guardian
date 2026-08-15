import { AdminOverviewService } from 'src/modules/admin/admin-overview.service';

/**
 * 設計規格 §2.1：營運層看得到 life_signal.evidence，看不到完整對話原文。
 * 交接規格 §6：「無原始數據牆」。
 */
describe('產品原則：長者總覽不含對話原文', () => {
  function buildService() {
    const elders = {
      find: jest.fn(async () => [
        {
          id: 'elder-1',
          displayName: '陳美玲',
          status: 'active',
          lineUserId: 'U-dev-elder-meiling',
        },
      ]),
    };
    const messages = {
      count: jest.fn(async () => 23),
      findOne: jest.fn(async () => ({ createdAt: new Date('2026-08-14T02:00:00Z') })),
    };
    const signals = { count: jest.fn(async () => 79) };
    const links = { count: jest.fn(async () => 1) };
    const baseline = {
      gate: jest.fn(async () => ({ canDetect: true, effectiveDays: 24, requiredDays: 21 })),
    };

    return {
      service: new AdminOverviewService(
        elders as never,
        messages as never,
        signals as never,
        links as never,
        baseline as never,
      ),
      messages,
    };
  }

  it('回傳數量與狀態，不含任何訊息內容欄位', async () => {
    const { service } = buildService();
    const rows = await service.listElders();

    expect(rows).toEqual([
      {
        elderId: 'elder-1',
        displayName: '陳美玲',
        status: 'active',
        messageCount: 23,
        signalCount: 79,
        effectiveDays: 24,
        requiredDays: 21,
        canDetect: true,
        guardianCount: 1,
        lastInteractionAt: '2026-08-14T02:00:00.000Z',
      },
    ]);
  });

  it('序列化後不出現任何訊息內容欄位', async () => {
    const { service } = buildService();
    const json = JSON.stringify(await service.listElders());

    for (const forbidden of ['text', 'textEncrypted', 'utterance', 'evidence']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('只用 count 取訊息數，不取出訊息本身', async () => {
    const { service, messages } = buildService();
    await service.listElders();

    // find/findBy 會把整列（含 text_encrypted）撈進記憶體。
    expect((messages as unknown as { find?: unknown }).find).toBeUndefined();
    expect(messages.count).toHaveBeenCalled();
  });
});
