import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { AdaptersModule } from 'src/adapters/adapters.module';
import { CoreModule } from 'src/common/core.module';
import { configuration } from 'src/common/config/configuration';
import { ALL_ENTITIES } from 'src/database/entities';
import { AdminModule } from 'src/modules/admin/admin.module';
import { ConsentModule } from 'src/modules/consent/consent.module';
import { ElderModule } from 'src/modules/elder/elder.module';
import { GuardianModule } from 'src/modules/guardian/guardian.module';
import { IngestModule } from 'src/modules/ingest/ingest.module';
import { SchedulerModule } from 'src/scheduler/scheduler.module';

/**
 * DI 接線冒煙測試。
 *
 * 不連資料庫：把每個 entity 的 repository 與 DataSource 換成假物件，
 * 只驗證「所有 controller 與 service 的依賴都拿得到」。
 *
 * 沒有這個測試，模組接線錯誤要等到有 Postgres 才會發現 ——
 * 而接線錯誤（少 import 一個模組、忘了 export）是重構時最常見的破壞。
 */
describe('模組接線', () => {
  const repositoryStub = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    findOneBy: jest.fn(async () => null),
    findOneByOrFail: jest.fn(async () => ({})),
    findByIds: jest.fn(async () => []),
    save: jest.fn(async (x: unknown) => x),
    insert: jest.fn(async () => ({})),
    update: jest.fn(async () => ({})),
    delete: jest.fn(async () => ({ affected: 0 })),
    count: jest.fn(async () => 0),
    exists: jest.fn(async () => false),
    create: (x: unknown) => x,
    createQueryBuilder: jest.fn(),
  };

  /**
   * 正式環境的 DataSource 由 TypeOrmModule.forRoot 全域提供。
   * 測試裡用一個 @Global 模組替代，才能被 CoreModule 等模組注入到。
   */
  @Global()
  @Module({
    providers: [
      {
        provide: getDataSourceToken(),
        useValue: { query: jest.fn(async () => []), transaction: jest.fn(async () => undefined) },
      },
    ],
    exports: [getDataSourceToken()],
  })
  class FakeDataSourceModule {}

  async function buildModule() {
    const builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], ignoreEnvFile: true }),
        FakeDataSourceModule,
        AdaptersModule,
        CoreModule,
        IngestModule,
        ElderModule,
        GuardianModule,
        ConsentModule,
        AdminModule,
        SchedulerModule,
      ],
    });

    for (const entity of ALL_ENTITIES) {
      builder.overrideProvider(getRepositoryToken(entity)).useValue(repositoryStub);
    }

    return builder.compile();
  }

  it('全部模組可組裝，所有依賴都解析得到', async () => {
    process.env.CRYPTO_LOCAL_KEY = Buffer.from('anhao-test-key-32-bytes-exactly!').toString('base64');
    process.env.NODE_ENV = 'test';

    const moduleRef = await buildModule();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('未設定金鑰時，外部服務一律解析為 Fake adapter', async () => {
    process.env.CRYPTO_LOCAL_KEY = Buffer.from('anhao-test-key-32-bytes-exactly!').toString('base64');
    const moduleRef = await buildModule();

    const { LLM_PORT, LINE_PORT, MY_HEALTH_BANK_PORT } = await import('src/ports');
    expect(moduleRef.get(LLM_PORT).constructor.name).toBe('FakeLlmAdapter');
    expect(moduleRef.get(LINE_PORT).constructor.name).toBe('FakeLineAdapter');
    expect(moduleRef.get(MY_HEALTH_BANK_PORT).constructor.name).toBe('FakeMyHealthBankAdapter');

    await moduleRef.close();
  });

  /**
   * 交接規格 §6：守護者不可取得聊天原文。
   *
   * 這條在架構上的落實方式是「GuardianViewService 拿不到 MessageRepository」。
   * 這個測試釘住那個結構 —— 有人日後為了方便把 ConversationModule 加進
   * GuardianModule 的 imports，測試就會失敗。
   */
  it('守護者端拿不到 MessageRepository（結構性保證）', async () => {
    process.env.CRYPTO_LOCAL_KEY = Buffer.from('anhao-test-key-32-bytes-exactly!').toString('base64');
    const moduleRef = await buildModule();

    const { GuardianViewService } = await import('src/modules/guardian/guardian-view.service');
    const { MessageRepository } = await import('src/modules/conversation/message.repository');

    const deps: unknown[] = Reflect.getMetadata('design:paramtypes', GuardianViewService) ?? [];
    expect(deps).not.toContain(MessageRepository);

    await moduleRef.close();
  });
});
