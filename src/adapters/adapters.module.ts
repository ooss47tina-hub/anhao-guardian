import { Global, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  COMMUNITY_ACTIVITY_PORT,
  CRYPTO_PORT,
  HPA_ELIGIBILITY_PORT,
  LINE_PORT,
  LLM_PORT,
  MY_HEALTH_BANK_PORT,
  OBJECT_STORAGE_PORT,
  OCR_PORT,
  STT_PORT,
} from 'src/ports';
import { KmsCryptoAdapter } from './crypto/kms-crypto.adapter';
import { LocalCryptoAdapter } from './crypto/local-crypto.adapter';
import { LineAdapter } from './real/line.adapter';
import { FakeLineAdapter } from './fake/fake-line.adapter';
import { FakeLlmAdapter } from './fake/fake-llm.adapter';
import { FakeOcrAdapter } from './fake/fake-ocr.adapter';
import {
  FakeCommunityActivityAdapter,
  FakeHpaEligibilityAdapter,
  FakeMyHealthBankAdapter,
  FakeObjectStorageAdapter,
} from './fake/fake-public-data.adapters';
import { FakeSttAdapter } from './fake/fake-stt.adapter';

/**
 * 外部依賴的組裝點。
 *
 * 設計意圖：領域模組只依賴 Port symbol，永遠不 import 具體 adapter。
 * 換真串接時只動這個檔案，其他程式碼不需要改。
 *
 * 未設定金鑰時一律 fake，所以 `npm test` 與 `npm run start:dev` 開箱即跑。
 */

function notImplemented(portName: string, file: string): never {
  throw new Error(
    `${portName} 的正式實作尚未完成。請建立 src/adapters/real/${file}，` +
      `或在 .env 移除對應金鑰以退回 fake（見 src/adapters/real/README.md）。`,
  );
}

const providers: Provider[] = [
  FakeLlmAdapter,
  FakeSttAdapter,
  FakeOcrAdapter,
  FakeLineAdapter,
  FakeMyHealthBankAdapter,
  FakeHpaEligibilityAdapter,
  FakeCommunityActivityAdapter,
  FakeObjectStorageAdapter,

  {
    provide: CRYPTO_PORT,
    inject: [ConfigService],
    useFactory: (config: ConfigService) =>
      config.get<string>('crypto.provider') === 'kms'
        ? new KmsCryptoAdapter(config)
        : new LocalCryptoAdapter(config),
  },
  {
    provide: LLM_PORT,
    inject: [ConfigService, FakeLlmAdapter],
    useFactory: (config: ConfigService, fake: FakeLlmAdapter) =>
      config.get<string>('llm.provider') === 'real' ? notImplemented('LlmPort', 'llm.adapter.ts') : fake,
  },
  {
    provide: STT_PORT,
    inject: [ConfigService, FakeSttAdapter],
    useFactory: (config: ConfigService, fake: FakeSttAdapter) =>
      config.get<string>('stt.provider') === 'real' ? notImplemented('SttPort', 'stt.adapter.ts') : fake,
  },
  {
    provide: OCR_PORT,
    inject: [ConfigService, FakeOcrAdapter],
    useFactory: (config: ConfigService, fake: FakeOcrAdapter) =>
      config.get<string>('ocr.provider') === 'real' ? notImplemented('OcrPort', 'ocr.adapter.ts') : fake,
  },
  {
    provide: LINE_PORT,
    inject: [ConfigService, FakeLineAdapter],
    useFactory: (config: ConfigService, fake: FakeLineAdapter) =>
      config.get<string>('line.provider') === 'real' ? new LineAdapter(config) : fake,
  },
  {
    provide: MY_HEALTH_BANK_PORT,
    inject: [ConfigService, FakeMyHealthBankAdapter],
    useFactory: (config: ConfigService, fake: FakeMyHealthBankAdapter) =>
      config.get<string>('myHealthBank.provider') === 'real'
        ? notImplemented('MyHealthBankPort', 'my-health-bank.adapter.ts')
        : fake,
  },
  {
    provide: HPA_ELIGIBILITY_PORT,
    inject: [ConfigService, FakeHpaEligibilityAdapter],
    useFactory: (config: ConfigService, fake: FakeHpaEligibilityAdapter) =>
      config.get<string>('hpa.provider') === 'real'
        ? notImplemented('HpaEligibilityPort', 'hpa-eligibility.adapter.ts')
        : fake,
  },
  {
    provide: COMMUNITY_ACTIVITY_PORT,
    inject: [ConfigService, FakeCommunityActivityAdapter],
    useFactory: (config: ConfigService, fake: FakeCommunityActivityAdapter) =>
      config.get<string>('communityActivity.provider') === 'real'
        ? notImplemented('CommunityActivityPort', 'community-activity.adapter.ts')
        : fake,
  },
  {
    provide: OBJECT_STORAGE_PORT,
    inject: [ConfigService, FakeObjectStorageAdapter],
    useFactory: (config: ConfigService, fake: FakeObjectStorageAdapter) =>
      config.get<string>('objectStorage.provider') === 'real'
        ? notImplemented('ObjectStoragePort', 'object-storage.adapter.ts')
        : fake,
  },
];

@Global()
@Module({
  providers,
  exports: providers.map((p) => ('provide' in p ? p.provide : p)),
})
export class AdaptersModule {}
