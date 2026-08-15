# 規格對照表

《工程交接規格 v1.0》每一節對應到程式的哪裡，以及這一輪做到什麼程度。

狀態說明：
- **已實作** — 邏輯完整、有測試或可實際執行
- **骨架** — 結構與契約完成，內部為 Fake 或簡化實作，換真串接不需改呼叫端
- **未做** — 這一輪不在範圍

---

## §1 系統邊界與資料流

| 階段 | 位置 | 狀態 |
|---|---|---|
| Ingest | `src/modules/ingest/` | 骨架（LINE 為 Fake，佇列為記憶體內） |
| Extract | `src/modules/extract/signal-extraction.service.ts` | 已實作（OpenAI structured outputs；未設 LLM_API_KEY 時退回規則式 Fake） |
| Baseline | `src/modules/baseline/baseline.service.ts` | 已實作 |
| Detect | `src/modules/detect/pattern-engine.service.ts` | 已實作 |
| Notify | `src/modules/notify/` | 已實作 |
| Audit | `src/common/audit/audit.service.ts` + DB trigger | 已實作 |

## §2 資料表

全部 21 張表定義於 `src/database/migrations/1755216000000-InitialSchema.ts`，
entity 依規格章節分四個檔案，方便逐節比對：

| 規格章節 | Entity 檔案 |
|---|---|
| §2.1 身分與關係 | `src/database/entities/identity.entities.ts` |
| §2.2 對話與訊號 | `src/database/entities/conversation.entities.ts` |
| §2.3 Baseline 與 Pattern | `src/database/entities/pattern.entities.ts` |
| §2.4 醫療、公部門資料與通知 | `src/database/entities/medical.entities.ts` |

### 與規格的差異

| 項目 | 差異 | 理由 |
|---|---|---|
| `link_invite` | 規格未列，本實作新增 | §3 的 `/v1/links/invite` 需要一次性邀請碼的存放處 |
| `persona_config_history` | 規格在備註提到，本實作建為正式表 | SRS F0-03 要求所有自動調整留下紀錄且可還原 |
| `elder.health_card_token` | 規格備註「只留 token 與到期日」，本實作明確建欄位 | 讓「不存身分證號」成為 schema 事實而非約定 |
| `pattern_alert.internal_only` | 規格未列，本實作新增 | §4「有效生活日不足只寫內部記錄」需要在資料層區分，否則通知層無從判斷 |
| `message` PK | 改為 `(id, created_at)` | 分區表的主鍵必須包含分區鍵 |
| `life_signal` PK | 改為 `(id, occurred_on)` | 同上 |

### 規格特別註記的實作方式

- **append-only**：`consent`、`audit_log` 由 `reject_mutation()` trigger 擋 UPDATE/DELETE。
  撤銷授權走 `revoke_consent()` 函式插入新列。
  唯一例外是長者行使刪除權 —— 見 `EraseException` migration，只放行 DELETE 且需交易內旗標。
- **每位長者僅一位 is_primary**：部分唯一索引 `guardian_link_one_primary_idx`
  （條件 `is_primary AND revoked_at IS NULL`），解除綁定後可指派新的主要守護者。
- **加密欄位**：`message.text_encrypted`、`gov_health_record.payload_encrypted`
  一律經 `CryptoPort` 進出。`MessageRepository` 是 `message.text` 的唯一存取入口。
- **分區**：`message`、`life_signal`、`baseline_snapshot` 按月 RANGE 分區。
  未做 elder_id hash 子分區 —— 理由見設計文件 §5 與 `Partitions` migration 的註解。
- **notification 的送出與抑制互斥**：DB CHECK 條件擋掉 `sent_at` 與 `suppressed_reason`
  同時非空的狀態。

## §3 API 端點

| 端點 | 位置 | 狀態 |
|---|---|---|
| `POST /webhook/line` | `ingest/line-webhook.controller.ts` | 骨架 |
| `POST /v1/chat/turn` | `elder/elder.controller.ts` | 骨架 |
| `POST /v1/stt` | `elder/elder.controller.ts` | 骨架 |
| `POST /v1/ocr/medical` | `medical/medication.service.ts`（經 ingest 圖片路徑） | 骨架 |
| `GET /v1/elders/{id}/status` | `guardian/guardian.controller.ts` | 已實作 |
| `GET /v1/elders/{id}/digest` | `guardian/guardian.controller.ts` | 已實作 |
| `GET /v1/alerts/{id}` | `guardian/guardian.controller.ts` | 已實作 |
| `POST /v1/alerts/{id}/ack` | `guardian/guardian.controller.ts` | 已實作 |
| `GET/PATCH /v1/elders/{id}/persona` | `elder/elder.controller.ts` | 已實作 |
| `POST /v1/consent` | `consent/consent.controller.ts` | 已實作 |
| `POST /v1/links/invite ｜ /accept` | `elder/elder.controller.ts` | 已實作 |
| `GET /v1/elders/{id}/public-health` | `elder/elder.controller.ts` | 骨架 |
| `GET /admin/review/queue` | `admin/admin.controller.ts` | 已實作 |
| `POST /admin/review/{signalId}` | `admin/admin.controller.ts` | 已實作 |
| `GET /admin/integrations` | `admin/admin.controller.ts` | 骨架 |
| `POST /v1/elders/{id}/export ｜ /erase` | `elder/elder.controller.ts` | 已實作 |

`POST /v1/ocr/medical` 目前沒有獨立的 HTTP 端點 —— 圖片走 LINE webhook 進來後
由 `IngestProcessor.handleImage` 呼叫 `MedicationService.ingestFromPhoto`。
若守護者端也要能上傳照片，需另開端點；契約已在 service 層備好。

## §4 排程作業

七項全數實作於 `src/scheduler/jobs.service.ts`，皆可 `npm run job -- <name>` 手動觸發。

`safety_rule` 不是排程 —— 它由 `ConversationService.handleTurn()` 在收到訊息時
即時觸發（`SafetyRuleService` → 立即通知 → audit log）。

額外新增 `partition_maintenance`（每日 03:00）：規格未列，但分區表缺分區會讓
INSERT 直接失敗，屬必要維運作業。

## §5 外部串接

四個來源全部 Port 化，Fake 實作已接上。正式串接位置與注意事項見
`src/adapters/real/README.md`。

規格要求的降級行為都已在骨架中實作：

- 健檢資格查詢失敗 → 以「上次日期 + 1 年」推算並標 `degraded`
- 活動資料抓取失敗 → 沿用快取；超過 14 天不顯示
- 健康存摺授權到期 → 停止取用（`isAuthorizationValid`）

## §6 合規與不可讓步的產品原則

見 [README 的對照表](../README.md#產品原則怎麼被程式強制)。九條全部有強制點，其中六條有測試。

未寫測試的三條與原因：

| 原則 | 為何沒有測試 |
|---|---|
| 無即時定位、無全程行程追蹤 | 這是「沒有某個東西」的性質 —— schema 裡沒有 location 欄位，程式碼裡沒有定位 API。測試無法有意義地斷言不存在的東西；靠 code review 守。 |
| 可匯出與刪除 | 已用 psql 實測級聯刪除（見文末），但尚未寫成自動化測試 —— 需要測試資料庫。 |
| North Star 指標 | 同上，需要真實資料。 |

## §7 建議技術選型

| 規格建議 | 本實作 | 差異說明 |
|---|---|---|
| PostgreSQL | ✅ TypeORM + 手寫 SQL migration | 分區、trigger、CHECK 條件 ORM 表達不出來，故手寫 |
| 按 elder_id 與月份分區 | 只做月份分區 | 兩層分區兩年內破千個分區，維運成本大於收益。查詢已帶 elder_id 索引 |
| SQS 或 Redis Streams | 記憶體內佇列 | **多副本部署前必須換掉**，見 `IngestQueue` 的 TODO(infra) |
| 物件儲存 + 生命週期規則 | Port 化，Fake 為記憶體 | 待接 S3 相容儲存 |
| 雲端 KMS | Port 化，本機為 AES-256-GCM | `LocalCryptoAdapter` 在 `NODE_ENV=production` 時拒絕啟動 |

---

## 接手第一週建議順序

1. **起環境**：`docker compose up -d` → `npm run migration:run` → `npm run seed` → `npm test`
2. **讀三個檔案**：`src/common/errors/product-rule.errors.ts`（產品原則長什麼樣）、
   `src/ports/index.ts`（外部依賴的邊界）、`src/scheduler/jobs.service.ts`（系統每天做什麼）
3. **接 LINE**：`src/adapters/real/line.adapter.ts`。這是唯一擋住端到端測試的依賴。
4. **接 LLM**：換掉 `FakeLlmAdapter` 後，用 SRS §11 的評測集跑 Signal Precision ≥ 85%。
5. **換佇列**：`IngestQueue` 改 BullMQ。在多副本部署之前完成。
6. **補 Admin RBAC**：`/admin/*` 目前無認證，正式部署前必須加上。

## 尚未處理的事項

| 項目 | 位置 | 影響 |
|---|---|---|
| `/admin/*` 無認證 | `admin/admin.controller.ts` TODO(auth) | 正式部署前必須補，否則人工修正介面全網公開 |
| 佇列為記憶體內 | `ingest/ingest.queue.ts` TODO(infra) | 重啟掉訊息；不可多副本 |
| KMS 未實作 | `adapters/crypto/kms-crypto.adapter.ts` TODO(infra) | 正式環境無法啟動（刻意設計） |
| LIFF JWT 未換發 | `common/auth/line-auth.guard.ts` TODO(auth) | 每次請求都打 LINE 驗證端點 |
| E-00 設定精靈未實作 | `ingest.processor.ts` autoRegister | 目前直接拿 LINE 顯示名稱當稱呼。LINE 名稱常是暱稱或英文名（實測拿到「Tina 王文利」），AI 叫起來不自然。SRS F0-01 要求精靈第三步詢問稱呼，並提供媽媽／王阿姨／本名等選項 |
| 活動距離過濾 | `publicdata/public-health.service.ts` TODO(product) | 目前只依 region_code 過濾。1.5 公里過濾需要長者位置，取得方式待產品決定 |
| 整合測試 | — | 目前全為單元測試。migration、trigger、級聯刪除已用 psql 手動驗證過（見下），但尚未自動化 |
| 日期以 UTC 為界 | 各 service 的 `toISOString().slice(0,10)` | occurred_on / computed_on / week_start 的日界是 UTC，比台北時間早 8 小時（例如週摘要的 week_start 會顯示週日日期）。目前全系統一致所以邏輯正確，但正式上線前應統一改為 Asia/Taipei 日界 |

## Baseline 只計入正向訊號值

`life_signal.value` 分成「事情發生了」與「事情沒發生」兩類，**只有前者進統計**
（`POSITIVE_SIGNAL_VALUES`，定義在 `src/domain/signal-dimension.ts`）。

原因：Baseline、Pattern、Digest 三處都是按維度數**筆數**、不看 value。
一筆 `outing=stayed_home` 會被算成一次外出，把基線灌高，接著讓
「近 7 天外出變少」的判斷失準。負向訊號仍然儲存（有臨床參考價值、供人工抽查），
只是不進統計。

新增 value 前先問：它代表「這件事發生了」還是「沒發生」？前者才加進清單。
三處查詢的 `value IN (...)` 過濾必須保持一致，否則「近 7 天」與「平常」
不是同一種東西在比較。

## 已用真實資料庫驗證過的行為

2026-08-15 以 Postgres 16 實測，結果如下：

- 四個 migration 依序執行成功，建出 42 個 relation（21 張表 + 分區與預設分區）
- `message` / `life_signal` / `baseline_snapshot` 各有 6 個月分區 + 1 個 default 分區
- 無 `app.erase_mode` 旗標時，`consent` 與 `audit_log` 的 UPDATE 與 DELETE 均被 trigger 拒絕
- 有旗標時，UPDATE **仍**被拒絕（只放行 DELETE），旗標不外洩到新連線
- `revoke_consent()` 正確插入 granted=false 的新列，未改動原列
- 刪除長者時 `consent` 隨之級聯清空，`audit_log` 保留
- 端到端：長者對話 → 訊號萃取 → 寫入 `life_signal`；高風險語句 → 即時通知守護者 → 寫 `audit_log`
- 守護者首頁在有效生活日 0 天時回「資料不足」，未輸出任何變化判斷
- 守護者代長者授權 `raw_chat_share` 回 403
- 長者呼叫守護者端點回 403
- STT 信心 0.42 時回 `needsRetry: true`，不進 LLM、不產生訊號
- 插入 7 筆 `outing=stayed_home` 後重跑 baseline_rebuild，outing 日均不變（0.464 → 0.464），且 7 筆訊號確實留在資料庫
- 真 LLM（gpt-5.6-terra）端到端：否定句「今天沒有出門」只產生 interaction，未產生假的外出訊號；被直接問「是不是失智了？」時回話未接該詞，僅記為 concern
