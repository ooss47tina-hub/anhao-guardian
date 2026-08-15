# 安好 AI 自主生活守護 — 後端骨架設計

- 日期：2026-08-15
- 對應規格：《工程交接規格 v1.0》（權威來源）、《SRS v2.1 AI Persona》、介面原型《安好 AI 自主生活守護》
- 範圍：完整後端骨架。資料層、API、排程、領域引擎全做；外部服務以 Port 介面 + Fake 實作接上。

## 1. 目標與非目標

**目標**：交出一份後端團隊能直接接手的可執行骨架。不需要任何外部金鑰即可 `npm test`、`npm run start:dev`，且交接規格第 6 節的九條產品原則各有測試釘死。

**非目標**：真實外部串接（健康存摺、國健署、LINE、LLM、STT、OCR）不在此輪。這些以 Port 定義契約、Fake 提供 fixture、Real adapter 留 `NotImplementedError` 與 TODO。前端（LIFF / Console）不做。

## 2. 技術選型

| 層 | 選擇 | 理由 |
|---|---|---|
| 語言 | TypeScript 5 | 與團隊既有 Next.js 生態同語言，型別可與守護者端共用 |
| 框架 | NestJS 11 | SRS 點名選項；模組化 / DI / `@nestjs/schedule` 適合多引擎系統 |
| 資料庫 | PostgreSQL 16 + TypeORM | 交接規格第 7 節指定；需交易與 append-only 稽核 |
| 佇列 | BullMQ + Redis | Webhook 3 秒內回 200 的硬需求 |
| 物件儲存 | S3 相容（Port 化） | 語音／照片，配合 `voice_retention` 生命週期 |
| 加密 | `CryptoPort`（本機 AES-256-GCM → 正式 KMS） | `message.text`、`gov_health_record.payload` 欄位級加密 |

## 3. 模組切法

依交接規格第 1 節的資料流切領域模組，另加三個橫切模組。

```
ingest → extract → memory → baseline → detect → notify
                                    ↘ medical
                                    ↘ publicdata

橫切：consent（授權閘門）／audit（稽核）／persona（互動人格）
```

| 模組 | 職責 | 對外介面 |
|---|---|---|
| `identity` | elder、guardian、guardian_link、邀請碼 | `POST /v1/links/invite`、`/accept` |
| `consent` | 用途分層同意、`ConsentGuard` | `POST /v1/consent` |
| `persona` | persona_config 與變更歷史、Preview | `GET/PATCH /v1/elders/:id/persona` |
| `ingest` | LINE Webhook 簽章驗證、入佇列 | `POST /webhook/line` |
| `conversation` | AI 回話（讀 persona + memory） | `POST /v1/chat/turn` |
| `extract` | 語句 → Life Signal、低信心佇列 | 內部 + `/admin/review/*` |
| `memory` | memory_item、長者確認閘門 | 內部 |
| `baseline` | 28 天分維度基線、每日快照 | 內部 |
| `detect` | Pattern Engine（P0–P3）、Safety Rule | `GET /v1/alerts/:id`、`/ack` |
| `notify` | 推播、安靜時段、週摘要 | `GET /v1/elders/:id/digest` |
| `medical` | 回診行程、OCR、藥品人工確認 | `POST /v1/ocr/medical` |
| `publicdata` | 健康存摺、健檢資格、社區活動 | `GET /v1/elders/:id/public-health` |
| `admin` | 抽查佇列、串接狀態 | `/admin/*` |
| `privacy` | 資料匯出與刪除 | `POST /v1/elders/:id/export`、`/erase` |

選這個切法的理由：交接規格第 6 節九條「不可讓步」的產品原則，每一條都落在單一模組邊界上，可以單獨寫測試釘死，不會散落各處。

## 4. 產品原則如何被程式強制

規格標示「不可」者為產品原則，實作時不得便宜行事。以下把每條對應到具體強制點：

| 原則 | 強制點 |
|---|---|
| 守護者不可取得聊天原文 | `ConsentGuard` + `GuardianView` DTO 白名單；守護者路由永不注入 `MessageRepository` |
| 授權須長者本人在 LINE 確認 | `POST /v1/consent` 只接受 elder LINE 身分；守護者角色一律 403 |
| 有效生活日 < 21 天不得判斷 | `BaselineGate.canDetect()`；未通過時 `detect` 只寫內部記錄 |
| 藥名劑量未人工確認不得建提醒 | `MedicationItem.human_verified_by` 為 null 時 `createReminder` 拋 `HumanReviewRequiredError` |
| 不輸出診斷 | `DiagnosticLanguageFilter` 掃描 LLM 輸出的診斷式詞彙並攔截 |
| 無即時定位、無原始數據牆 | 無 location 欄位；守護者端無 raw signal 端點 |
| 通知可回溯 | `pattern_alert` 強制寫入 `rule_version` / `model_version` / `prompt_version` / `baseline_snapshot_id` |
| 可匯出與刪除 | `privacy` 模組；刪除為硬刪 + 稽核，不留可還原副本 |
| North Star 為有效生活天數 | 指標模組只計算 `effective_life_days`，不記聊天次數 |

append-only 的兩張表（`consent`、`audit_log`）用 DB trigger 擋 UPDATE/DELETE，不只靠應用層自律。

## 5. 資料層

- 全表定義見 `src/database/migrations/`，對應交接規格第 2 節。
- `life_signal`、`baseline_snapshot`、`message` 按 `elder_id` hash + 月份 RANGE 分區（規格第 7 節）。
- 索引重點：`life_signal(elder_id, occurred_on, dimension)`、`pattern_alert(elder_id, created_at, level)`、`medical_journey(elder_id, visit_at)`。
- 欄位級加密：`message.text`、`gov_health_record.payload` 存密文，經 `CryptoPort` 進出。

## 6. 外部依賴（Port + Fake）

`LlmPort`、`SttPort`、`OcrPort`、`LinePort`、`MyHealthBankPort`、`HpaEligibilityPort`、`CommunityActivityPort`、`ObjectStoragePort`、`CryptoPort`。

每個 Port 各有 `fake/` 實作讀 `test/fixtures/`，所以整套不需金鑰即可跑起來與測試。`real/` 留簽章與 TODO，標註待商務／法務確認的三項（健康存摺介接資格、地方衛生局更新頻率、語音留存上限）。

## 7. 排程

七個 job 對應交接規格第 4 節，全部可用 CLI 手動觸發（`npm run job -- <name>`）方便驗收：
`activity_sync` 05:30、`health_record_sync` 06:00、`baseline_rebuild` 07:00、`pattern_detect` 07:30、`digest_build` 週一 09:00、`eligibility_check` 週一 09:00、`safety_rule`（即時，不受安靜時段限制）。

## 8. 測試策略

主軸放在產品原則而非 CRUD。每條原則一組會失敗的測試，例如：

- 有效生活日 19 天時 `pattern_detect` 只寫內部記錄，`notification` 表零筆。
- `medication_item.human_verified_by` 為 null 時建立用藥提醒拋錯。
- 守護者呼叫 `GET /v1/elders/:id/status` 的回應中不得出現任何 `message.text` 內容。
- `consent` 表的 UPDATE 被 DB trigger 拒絕。
- 安靜時段內的 P2 通知寫入 `notification` 且 `suppressed_reason` 非空；P3 高風險不受限制。

## 9. 已知規格衝突

**Baseline 門檻**：交接規格第 4 節寫「有效生活日 < 21 天者只寫內部記錄」；SRS F2-01 寫「至少 21 天**且**至少 12 個有效生活日」。兩者不一致。

處理：實作為可設定的 `BaselineGate`，預設採交接規格（21 個有效生活日，較嚴格），設定值收在 `baseline.config.ts` 並標註 `SPEC-CONFLICT`。待產品確認後改設定即可，不需改邏輯。

## 10. 待確認事項（沿用交接規格第 7 節）

1. 健康存摺 API 的正式介接資格與申請流程
2. 各地方衛生局開放資料的更新頻率差異
3. 語音留存的保存期限上限

這三項會影響 consent 文案與排程設計，在程式中以 `TODO(business)` 標註。
