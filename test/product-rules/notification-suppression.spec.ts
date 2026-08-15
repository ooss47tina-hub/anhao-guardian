import { PatternAlert } from 'src/database/entities';
import { NotificationService } from 'src/modules/notify/notification.service';

/**
 * 交接規格 §1 Notify、§2.4、§4、§6。
 *
 * 三條規則同時測：
 * - 只有 P2／P3 才打擾家人，P0／P1 不推播
 * - 有效生活日不足（internal_only）不得產生家人通知
 * - 安靜時段抑制 P2，但 P3 高風險不受限制
 * - 被抑制者仍寫入 notification 並記 suppressed_reason
 */
describe('產品原則：通知抑制與可追溯', () => {
  const pushed: Array<{ text: string }> = [];
  const written: Array<Record<string, unknown>> = [];

  function buildService(options: {
    hasPatternShare?: boolean;
    quietHours?: { start: string; end: string };
  }) {
    pushed.length = 0;
    written.length = 0;

    const notifications = {
      create: (x: Record<string, unknown>) => x,
      save: jest.fn(async (x: Record<string, unknown>) => {
        written.push(x);
        return { ...x, id: `notif-${written.length}` };
      }),
    };
    const links = {
      findOne: jest.fn(async () => ({ guardianId: 'guardian-1', elderId: 'elder-1' })),
    };
    const guardians = {
      findOneByOrFail: jest.fn(async () => ({
        id: 'guardian-1',
        lineUserId: 'U-guardian',
        quietHoursStart: options.quietHours?.start ?? null,
        quietHoursEnd: options.quietHours?.end ?? null,
      })),
    };
    const acks = {
      createQueryBuilder: () => ({
        innerJoin: () => acks.createQueryBuilder(),
        where: () => acks.createQueryBuilder(),
        andWhere: () => acks.createQueryBuilder(),
        getCount: async () => 0,
      }),
    };
    const consent = { has: jest.fn(async () => options.hasPatternShare ?? true) };
    const diagnosticFilter = { assertClean: jest.fn() };
    const config = { get: jest.fn(() => undefined) };
    const line = { push: jest.fn(async (m: { text: string }) => void pushed.push(m)) };

    return new NotificationService(
      notifications as never,
      links as never,
      guardians as never,
      acks as never,
      consent as never,
      diagnosticFilter as never,
      config as never,
      line as never,
    );
  }

  function alert(overrides: Partial<PatternAlert>): PatternAlert {
    return {
      id: 'alert-1',
      elderId: 'elder-1',
      level: 'P2',
      dimensions: ['outing'],
      headline: '近 7 天外出比平常少',
      explanation: '近 7 天外出訊號 1 次；個人近 28 天平均每週 4 次。',
      internalOnly: false,
      ruleVersion: 'rule-v1.3',
      modelVersion: 'llm-2026-07',
      promptVersion: 'prompt-v2.1',
      createdAt: new Date(),
      ...overrides,
    } as PatternAlert;
  }

  it.each(['P0', 'P1'] as const)('%s 不推播家人，但仍留紀錄', async (level) => {
    const service = buildService({});
    const result = await service.dispatchAlert(alert({ level }));

    expect(result.sent).toBe(false);
    expect(result.suppressedReason).toBe('level_not_notifiable');
    expect(pushed).toHaveLength(0);
    expect(written).toHaveLength(1);
    expect(written[0].suppressedReason).toBe('level_not_notifiable');
  });

  it('有效生活日不足（internal_only）時，P2 也不得通知家人', async () => {
    const service = buildService({});
    const result = await service.dispatchAlert(alert({ level: 'P2', internalOnly: true }));

    expect(result.sent).toBe(false);
    expect(result.suppressedReason).toBe('internal_only_insufficient_baseline');
    expect(pushed).toHaveLength(0);
  });

  it('未取得 pattern_share 授權時不得通知家人', async () => {
    const service = buildService({ hasPatternShare: false });
    const result = await service.dispatchAlert(alert({ level: 'P2' }));

    expect(result.suppressedReason).toBe('consent_pattern_share_missing');
    expect(pushed).toHaveLength(0);
  });

  it('安靜時段內抑制 P2', async () => {
    const service = buildService({ quietHours: { start: '22:00', end: '07:30' } });
    const at2330 = new Date('2026-08-15T23:30:00');

    const result = await service.dispatchAlert(alert({ level: 'P2' }), at2330);

    expect(result.sent).toBe(false);
    expect(result.suppressedReason).toBe('quiet_hours');
    expect(pushed).toHaveLength(0);
  });

  it('P3 高風險不受安靜時段限制', async () => {
    const service = buildService({ quietHours: { start: '22:00', end: '07:30' } });
    const at2330 = new Date('2026-08-15T23:30:00');

    const result = await service.dispatchAlert(alert({ level: 'P3' }), at2330);

    expect(result.sent).toBe(true);
    expect(result.suppressedReason).toBeNull();
    expect(pushed).toHaveLength(1);
  });

  it('安靜時段外的 P2 正常送出', async () => {
    const service = buildService({ quietHours: { start: '22:00', end: '07:30' } });
    const at0900 = new Date('2026-08-15T09:00:00');

    const result = await service.dispatchAlert(alert({ level: 'P2' }), at0900);

    expect(result.sent).toBe(true);
    expect(pushed).toHaveLength(1);
    expect(written[0].sentAt).toBeInstanceOf(Date);
    expect(written[0].suppressedReason).toBeNull();
  });
});
