import { InsufficientBaselineError } from 'src/common/errors/product-rule.errors';
import { BaselineService } from 'src/modules/baseline/baseline.service';

/**
 * 交接規格 §4、§6；SRS F2-01。
 * 「有效生活日不足 21 天時不可產生『跟平常不一樣』的判斷或家人通知。」
 *
 * SPEC-CONFLICT：SRS F2-01 寫「至少 21 天且至少 12 個有效生活日」。
 * 預設採交接規格（21 個有效生活日）。門檻由設定值控制，這裡一併驗證可調。
 */
describe('產品原則：Baseline 門檻閘門', () => {
  function buildService(effectiveDays: number, requiredDays = 21): BaselineService {
    const signals = {
      createQueryBuilder: () => {
        const qb: Record<string, unknown> = {};
        for (const method of ['select', 'addSelect', 'where', 'andWhere', 'groupBy', 'addGroupBy']) {
          qb[method] = () => qb;
        }
        qb.getRawMany = async () => [{ count: String(effectiveDays) }];
        return qb;
      },
    };
    const snapshots = {};
    const config = {
      get: (key: string) =>
        key === 'rules.baselineMinEffectiveDays'
          ? requiredDays
          : key === 'rules.baselineWindowDays'
            ? 28
            : undefined,
    };
    return new BaselineService(signals as never, snapshots as never, config as never);
  }

  it('有效生活日 19 天時不得判斷', async () => {
    const result = await buildService(19).gate('elder-1', new Date('2026-08-15'));

    expect(result.canDetect).toBe(false);
    expect(result.effectiveDays).toBe(19);
    expect(result.requiredDays).toBe(21);
  });

  it('恰好 21 天時通過', async () => {
    const result = await buildService(21).gate('elder-1', new Date('2026-08-15'));
    expect(result.canDetect).toBe(true);
  });

  it('assertCanDetect 在門檻未達時拋 InsufficientBaselineError', async () => {
    await expect(
      buildService(12).assertCanDetect('elder-1', new Date('2026-08-15')),
    ).rejects.toBeInstanceOf(InsufficientBaselineError);
  });

  it('門檻可由設定調整，不需改判斷邏輯（SPEC-CONFLICT 解法）', async () => {
    // 若產品最終採 SRS 的 12 個有效生活日，只需改設定值。
    const result = await buildService(12, 12).gate('elder-1', new Date('2026-08-15'));
    expect(result.canDetect).toBe(true);
    expect(result.requiredDays).toBe(12);
  });
});
