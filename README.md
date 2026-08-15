# 安好 AI 自主生活守護 — 後端

對應《工程交接規格 v1.0》與《SRS v2.1 AI Persona》的後端骨架。
TypeScript + NestJS 11 + PostgreSQL 16。

## 快速開始

不需要任何外部服務金鑰即可跑起來 —— LLM、STT、OCR、LINE、健康存摺等一律使用
Fake adapter（讀 fixture）。

```bash
npm install
cp .env.example .env
docker compose up -d          # Postgres + Redis
npm run migration:run
npm run seed                  # 建立示範長者與守護者
npm run start:dev
```

測試不需要資料庫：

```bash
npm test
```

## 守護者端網頁

`web/` 是守護者端（G-01～G-05），Next.js 16 + React 19，對接本後端。

```bash
cd web && npm install && cp .env.example .env.local && npm run dev
```

開 <http://localhost:3001>。後端需同時執行（:3000）。

頁面對應：`/` G-01 最近好嗎、`/digest` G-02 本週摘要、`/alerts/[id]` G-03 變化詳情、
`/journeys` G-04 醫療行程、`/settings` G-05 設定與授權。桌機與手機（LIFF 尺寸）皆已驗證。

身分目前用 FakeLineAdapter 的示範 token；正式環境改由 LIFF 取得 id_token —— 只需改
`web/lib/api.ts` 的 `token()` 一個函式，頁面程式碼不動。

## 開發檢視頁

後端跑起來後，用瀏覽器開 <http://localhost:3000/dev>：

- 左側是守護者視角（G-01 首頁、G-02 週摘要、G-03 變化詳情），資料經過與正式 API 相同的授權過濾
- 中間可扮演長者對話（E-02），含高風險語句一鍵測試
- 一鍵切換三種情境（值得關心／穩定／資料不足），等同 `seed:history` + 兩個排程
- 通知紀錄含被抑制者與抑制原因；raw_chat_share 可切換，觀察 G-03 原句的出現與消失

僅開發環境可用；production 不載入且一律 404。這不是正式前端 —— 正式守護者端為 LIFF/Web，另案開發。

## 手動觸發排程

交接規格 §4 的每個作業都能單獨重跑，方便驗收：

```bash
npm run job -- baseline_rebuild
```

要看 Baseline → Pattern → 通知整條鏈路，先灌 28 天模擬訊號再跑排程：

```bash
npm run seed:history               # 近一週外出與社交驟減 → P2 通知
npm run seed:history -- stable     # 全週如常 → 不產生 alert
npm run seed:history -- insufficient  # 有效生活日 20 天 → 只寫內部記錄，不通知
npm run job -- baseline_rebuild
npm run job -- pattern_detect
```

job 可帶第二個參數假裝「現在」是某個時間，例如避開安靜時段、或在週一產摘要：

```bash
npm run job -- digest_build 2026-08-17T09:00:00
```

可用的作業名稱：`activity_sync`、`health_record_sync`、`baseline_rebuild`、
`pattern_detect`、`digest_build`、`eligibility_check`、`partition_maintenance`。

`safety_rule` 不在清單中 —— 它是即時的，由 `ConversationService` 在收到訊息時
直接觸發，不等 Pattern、不受安靜時段限制。

## 目錄結構

```
src/
├─ common/          橫切關注點：稽核、授權閘門、安全規則、診斷語言過濾、設定、版本
├─ domain/          維度、分級等領域型別
├─ ports/           外部依賴的契約（LLM / STT / OCR / LINE / 公部門 / 儲存 / 加密）
├─ adapters/
│  ├─ fake/         讀 fixture 的假實作，無金鑰即可跑
│  ├─ crypto/       本機 AES-256-GCM 與 KMS（待實作）
│  └─ real/         正式串接位置，見該目錄 README
├─ database/        entity（依交接規格章節分檔）、migration、seed
├─ modules/         領域模組，見下表
└─ scheduler/       排程作業與 CLI
```

| 模組 | 對應規格 |
|---|---|
| `identity` | §2.1 身分與關係、§3 綁定 |
| `consent` | §2.1 consent、§3 `POST /v1/consent` |
| `persona` | §2.1 persona_config、SRS 4.0 |
| `ingest` | §1 Ingest、§3 `POST /webhook/line` |
| `conversation` | §2.2 message、§3 `POST /v1/chat/turn` |
| `extract` | §1 Extract、§2.2 life_signal |
| `memory` | §2.2 memory_item |
| `baseline` | §2.3 baseline_snapshot、SRS F2-01 |
| `detect` | §2.3 pattern_alert、SRS F2-02 |
| `notify` | §2.4 notification、§2.3 weekly_digest |
| `medical` | §2.4 medical_journey / medication_item |
| `publicdata` | §5 外部串接 |
| `guardian` | §3 守護者端 |
| `admin` | §3 Console |
| `privacy` | §3 export / erase |

## 產品原則怎麼被程式強制

交接規格 §6 列了九條「不可讓步」的原則。每一條都有對應的強制點與測試：

| 原則 | 強制點 | 測試 |
|---|---|---|
| 守護者不可取得聊天原文 | `GuardianViewService` 拿不到 `MessageRepository`；`GuardianModule` 不 import `ConversationModule` | `test/di-graph.spec.ts` |
| 授權由長者本人確認 | `ConsentService.grant/revoke` 檢查 actorRole | `test/product-rules/consent-and-raw-chat.spec.ts` |
| 有效生活日不足不得判斷 | `BaselineService.gate()`；不足時 `internal_only = true` | `baseline-gate.spec.ts`、`notification-suppression.spec.ts` |
| 藥名劑量未確認不得建提醒 | `MedicationService.createReminder` 拋 `HumanReviewRequiredError` | `medication-human-review.spec.ts` |
| 不輸出診斷 | `DiagnosticLanguageFilter.assertClean()`，寫入與推播前一律過 | `no-diagnosis.spec.ts` |
| 無定位、無原始數據牆 | schema 無 location 欄位；守護者端無 raw signal 端點 | — |
| 通知可回溯 | `pattern_alert` 的 rule/model/prompt version 為 NOT NULL | migration CHECK |
| 可匯出與刪除 | `PrivacyService`，刪除為硬刪 + 二次確認 | — |
| North Star 為有效生活天數 | `/admin/quality` 只回報 precision 與通知數，不提供聊天次數 | — |

`consent` 與 `audit_log` 的 append-only 由 DB trigger 強制（`reject_mutation()`），
不只靠應用層自律。撤銷授權必須走 `revoke_consent()` 函式插入新列。

## 已知規格衝突

**Baseline 門檻**：交接規格 §4 寫「有效生活日 < 21 天只寫內部記錄」；
SRS F2-01 寫「至少 21 天**且**至少 12 個有效生活日」。

目前採交接規格（較嚴格），門檻值在 `BASELINE_MIN_EFFECTIVE_DAYS` 環境變數。
產品確認後改設定即可，不需動判斷邏輯。

## 待商務與法務確認

沿用交接規格 §7，程式中以 `TODO(business)` 標註：

1. 健康存摺 API 的正式介接資格與申請流程
2. 各地方衛生局開放資料的更新頻率差異
3. 語音留存的保存期限上限

## 接手前必讀

- [`docs/HANDOFF.md`](docs/HANDOFF.md) — 規格條文與程式位置的逐項對照
- [`src/adapters/real/README.md`](src/adapters/real/README.md) — 正式外部串接的做法與地雷
- [`docs/superpowers/specs/2026-08-15-anhao-guardian-backend-design.md`](docs/superpowers/specs/2026-08-15-anhao-guardian-backend-design.md) — 設計決策與取捨
