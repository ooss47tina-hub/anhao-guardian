import { HumanReviewRequiredError } from 'src/common/errors/product-rule.errors';
import { MedicationService } from 'src/modules/medical/medication.service';
import { MedicationItem } from 'src/database/entities';

/**
 * 交接規格 §2.4、§6：藥名與劑量未經人工確認不可建立用藥提醒。
 * SRS F4-03 同。
 *
 * 這是本系統風險最高的一條 —— 錯誤的用藥提醒會直接造成傷害。
 */
describe('產品原則：藥品人工確認', () => {
  const notificationsSave = jest.fn(async (x: unknown) => x);

  function buildService(item: Partial<MedicationItem>): MedicationService {
    const items = {
      findOneByOrFail: jest.fn(async () => item as MedicationItem),
      save: jest.fn(async (x: unknown) => x),
      count: jest.fn(async () => 0),
    };
    const notifications = {
      save: notificationsSave,
      create: (x: unknown) => x,
    };
    const audit = { record: jest.fn() };
    const ocr = { readMedicalDocument: jest.fn() };

    return new MedicationService(
      items as never,
      notifications as never,
      audit as never,
      ocr as never,
    );
  }

  beforeEach(() => notificationsSave.mockClear());

  it('human_verified_by 為 null 時，建立用藥提醒必須拋錯', async () => {
    const service = buildService({
      id: 'item-1',
      elderId: 'elder-1',
      ocrRaw: '普拿疼 500mg 一日三次',
      drugName: '普拿疼',
      dosage: '500mg 一日三次',
      humanVerifiedBy: null,
      verifiedAt: null,
    });

    await expect(
      service.createReminder({ itemId: 'item-1', elderId: 'elder-1', scheduledAt: new Date() }),
    ).rejects.toBeInstanceOf(HumanReviewRequiredError);

    // 更重要的是：沒有任何通知被寫進去。
    expect(notificationsSave).not.toHaveBeenCalled();
  });

  it('有 human_verified_by 但缺 verified_at 時，同樣視為未確認', async () => {
    const service = buildService({
      id: 'item-2',
      elderId: 'elder-1',
      ocrRaw: '骨鈣寧 一日一次',
      humanVerifiedBy: 'reviewer-1',
      verifiedAt: null,
    });

    await expect(
      service.createReminder({ itemId: 'item-2', elderId: 'elder-1', scheduledAt: new Date() }),
    ).rejects.toBeInstanceOf(HumanReviewRequiredError);
    expect(notificationsSave).not.toHaveBeenCalled();
  });

  it('人工確認完成後才可建立提醒', async () => {
    const service = buildService({
      id: 'item-3',
      elderId: 'elder-1',
      ocrRaw: '普拿疼 500mg 一日三次',
      drugName: '普拿疼',
      dosage: '500mg 一日三次',
      humanVerifiedBy: 'reviewer-1',
      verifiedAt: new Date(),
    });

    await service.createReminder({ itemId: 'item-3', elderId: 'elder-1', scheduledAt: new Date() });
    expect(notificationsSave).toHaveBeenCalledTimes(1);
  });

  it('待覆核清單只回未確認的項目，最舊的排前面', async () => {
    const rows = [
      { id: 'item-1', humanVerifiedBy: null, createdAt: new Date('2026-08-01') },
      { id: 'item-2', humanVerifiedBy: 'reviewer-1', createdAt: new Date('2026-08-02') },
    ];
    const items = {
      find: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        expect(where).toHaveProperty('humanVerifiedBy');
        return rows.filter((r) => r.humanVerifiedBy === null);
      }),
    };
    // MedicationService constructor：items, notifications, audit, ocr（共 4 個）
    const service = new MedicationService(
      items as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const pending = await service.pendingItems();

    expect(pending.map((i) => i.id)).toEqual(['item-1']);
    expect(items.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { createdAt: 'ASC' } }),
    );
  });
});
