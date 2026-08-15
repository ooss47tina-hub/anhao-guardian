/**
 * 集中式設定。所有產品規則門檻都在這裡，實作程式碼不得硬編數字。
 * 對應《工程交接規格 v1.0》第 4、5、7 節。
 */

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function float(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type ExternalProvider = 'fake' | 'real';

function provider(value: string | undefined): ExternalProvider {
  return value && value !== 'fake' ? 'real' : 'fake';
}

export const configuration = () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3000),

  database: {
    url: process.env.DATABASE_URL ?? 'postgres://anhao:anhao@localhost:5432/anhao',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  crypto: {
    provider: (process.env.CRYPTO_PROVIDER ?? 'local') as 'local' | 'kms',
    localKey: process.env.CRYPTO_LOCAL_KEY ?? '',
    kmsKeyId: process.env.CRYPTO_KMS_KEY_ID ?? '',
  },

  line: {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '',
    channelSecret: process.env.LINE_CHANNEL_SECRET ?? '',
    channelId: process.env.LINE_CHANNEL_ID ?? '',
    /** 填了 channel secret 就走真串接，否則 fake。 */
    provider: provider(process.env.LINE_CHANNEL_SECRET ? 'real' : undefined),
    /** 加好友後自動建立長者資料（僅開發／試用階段；正式應走 M1 邀請流程）。 */
    autoRegisterElder: process.env.LINE_AUTO_REGISTER_ELDER === 'true',
  },

  llm: {
    /** 填了 LLM_API_KEY 就走真串接（OpenAI），否則 fake。 */
    provider: provider(process.env.LLM_API_KEY ? 'real' : undefined),
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? '',
    /** 相容 OpenAI API 的自架或代理端點；留空走官方。 */
    baseUrl: process.env.LLM_BASE_URL ?? '',
  },
  stt: { provider: provider(process.env.STT_PROVIDER) },
  ocr: { provider: provider(process.env.OCR_PROVIDER) },

  myHealthBank: {
    provider: provider(process.env.MYHEALTHBANK_CLIENT_ID ? 'real' : undefined),
    clientId: process.env.MYHEALTHBANK_CLIENT_ID ?? '',
    clientSecret: process.env.MYHEALTHBANK_CLIENT_SECRET ?? '',
    baseUrl: process.env.MYHEALTHBANK_BASE_URL ?? '',
  },

  hpa: {
    provider: provider(process.env.HPA_API_KEY ? 'real' : undefined),
    apiKey: process.env.HPA_API_KEY ?? '',
    baseUrl: process.env.HPA_BASE_URL ?? '',
  },

  communityActivity: {
    provider: provider(process.env.COMMUNITY_ACTIVITY_DATASET_URL ? 'real' : undefined),
    datasetUrl: process.env.COMMUNITY_ACTIVITY_DATASET_URL ?? '',
  },

  objectStorage: {
    provider: provider(process.env.OBJECT_STORAGE_PROVIDER),
    bucket: process.env.OBJECT_STORAGE_BUCKET ?? '',
  },

  /**
   * 產品規則門檻。改這裡即可調整行為，不需動判斷邏輯。
   */
  rules: {
    /**
     * SPEC-CONFLICT：交接規格第 4 節「有效生活日 < 21 天者只寫內部記錄，不通知家人」；
     * SRS F2-01「至少 21 天且至少 12 個有效生活日」。兩者不一致。
     * 預設採交接規格（較嚴格）。待產品確認後改設定值即可。
     */
    baselineMinEffectiveDays: int(process.env.BASELINE_MIN_EFFECTIVE_DAYS, 21),
    baselineWindowDays: int(process.env.BASELINE_WINDOW_DAYS, 28),

    /** 交接規格第 3 節 POST /v1/stt：低於 0.75 要求長者重說，不猜語意。 */
    sttMinConfidence: float(process.env.STT_MIN_CONFIDENCE, 0.75),

    /** 低於此信心值的 Life Signal 進人工佇列（交接規格第 1 節 Extract）。 */
    signalReviewConfidenceThreshold: float(process.env.SIGNAL_REVIEW_CONFIDENCE_THRESHOLD, 0.7),

    /** 安靜時段。高風險（P3 / Safety Rule）不受此限制。 */
    quietHoursStart: process.env.QUIET_HOURS_START ?? '22:00',
    quietHoursEnd: process.env.QUIET_HOURS_END ?? '07:30',

    /** 社區活動快取超過此天數不得顯示（交接規格第 5 節）。 */
    communityActivityMaxCacheDays: 14,

    /** 邀請碼有效期（交接規格第 3 節 /v1/links/invite）。 */
    inviteCodeTtlHours: 24,

    /** TODO(business)：語音留存保存期限上限待法務確認。 */
    voiceRetentionDays: int(process.env.VOICE_RETENTION_DAYS, 90),
  },
});

export type AppConfig = ReturnType<typeof configuration>;
