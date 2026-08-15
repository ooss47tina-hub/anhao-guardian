# 正式外部串接位置

這個目錄目前是空的。所有 Port 的契約定義在 `src/ports/`，假實作在 `src/adapters/fake/`。

接手時每個 Port 各建一個檔案，並在 `src/adapters/adapters.module.ts` 的 provider factory
加上對應分支即可 —— 領域模組完全不需要改動。

| Port | 建議檔名 | 串接重點 |
|---|---|---|
| `LinePort` | ✅ `line.adapter.ts` | Webhook 簽章驗證（HMAC-SHA256 + Channel Secret）；`fetchContent` 走 `api-data.line.me`；push 需處理 429 重試 |
| `LlmPort` | ✅ `openai-llm.adapter.ts` | 已實作（OpenAI）。structured outputs（json_schema + strict）+ 本地驗證層。prompt 在 `openai-llm.prompts.ts`，改動須進 `prompt_version` |
| `SttPort` | `stt.adapter.ts` | zh-TW；台語列 Phase 1.5（SRS 3.2）。信心值必須是真實信心，不可回傳常數 |
| `OcrPort` | `ocr.adapter.ts` | 藥品欄位一律 `needsHumanReview: true`，型別已強制 |
| `MyHealthBankPort` | `my-health-bank.adapter.ts` | OAuth 2.0 + FHIR R4。**原始 JSON 不落地**：解析後只留必要欄位再丟棄回應 |
| `HpaEligibilityPort` | `hpa-eligibility.adapter.ts` | 個資最小化查詢。失敗時回傳 `degraded: true`，不可拋錯讓上層以為沒資格 |
| `CommunityActivityPort` | `community-activity.adapter.ts` | Open Data CSV / JSON。各地方衛生局 schema 不一致，需 per-dataset mapper |
| `ObjectStoragePort` | `object-storage.adapter.ts` | 設 lifecycle rule 配合 `voice_retention` 自動刪除 |
| `CryptoPort` | 已有 `../crypto/kms-crypto.adapter.ts` | Envelope encryption；正式環境必用 |

## 開始串接前必須確認（交接規格第 7 節）

1. 健康存摺 API 的正式介接資格與申請流程
2. 各地方衛生局開放資料的更新頻率差異
3. 語音留存的保存期限上限

這三項會影響 consent 文案與排程設計。
