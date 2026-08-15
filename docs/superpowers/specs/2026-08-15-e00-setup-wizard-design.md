# E-00 Persona 設定精靈 — 設計

- 日期：2026-08-15
- 對應規格：《工程交接規格 v1.0》（權威來源）第 3 節；《SRS v2.1 AI Persona》4.0、8.1（E-00 / E-00A / E-00B）
- 範圍：LINE 對話式的首次設定精靈，四步 + Preview。含既有使用者補跑規則。

## 1. 為什麼要做

長者加好友後，AI 的稱呼直接取自 LINE 顯示名稱（`ingest.processor.ts` `autoRegister`）。
LINE 顯示名稱常是暱稱或中英混寫 —— 實測拿到「Tina 王文利」，AI 每句話這樣叫很不自然。

SRS 8.1 定義 E-00 為五步：`選 Template → 名稱 → 聲音／形象 → 稱呼 → 主動程度`。
SRS 4.0 要求「首次啟用由長者本人為主、家人協助完成；完成 Preview 後才進入日常對話」。

交接規格對 E-00 只有一句約束（第 3 節 API 表）：
`GET / PATCH /v1/elders/{id}/persona` 服務 E-00，「守護者可代設語氣，不可代設分享範圍」。

## 2. 範圍決定

### 2.1 這次做四步，不做第三步

SRS 的第三步「聲音／形象」這次**不做**。

`voiceId` 與 `avatarKey` 在程式裡只是兩個欄位 —— 沒有 TTS port、沒有 avatar 圖檔、
沒有任何地方會讀它們。現在問長者，答案會存進 DB 但不會改變任何體驗，
只是白白增加設定負擔。

SRS 欄位表本身也寫 `voice_id` 是「語音啟用時必填」（條件必填），與此一致。
待 TTS 接上後補第三步，屆時 `PersonaConfig` 不需改 schema。

四步為：`template → name → salutation → initiative`。

### 2.2 精靈可跳過

SRS 4.0 字面上要求「完成 Preview 後才進入日常對話」。本設計**不採硬性 gating**。

理由：許多高齡使用者不會也不想回答設定題。硬卡在門口的結果是服務直接用不了，
比稱呼不自然嚴重得多。長者說「等一下再說」即退出精靈，用預設值先聊，
之後最多再輕輕提 2 次（合計 `ask_count` 上限 3）。

此為對 SRS 4.0 的明確偏離，記於 `docs/HANDOFF.md` 規格偏離表。

### 2.3 順帶修正 E-00B 的一則假註解

`line.port.ts:53` 註解寫「長者可直接跟 AI 說『叫我阿姨就好』來改」，
但 `persona.service.ts` `applyAdaptiveStyle` 的四條 regex 沒有一條處理稱呼 ——
這句註解目前是假的。精靈的稱呼解析器現成，接上 E-00B 即可讓註解成真。

## 3. 為什麼是決定性狀態機

三個方案評估過：

| 方案 | 取捨 |
|---|---|
| **A. 決定性狀態機 + LLM 只做單句解析**（採用） | 狀態轉移不需 LLM 即可測；精靈壞掉是程式 bug，不是 prompt 調參問題 |
| B. 狀態塞進 `PersonaConfig` 加 `setup_step` | 省一張表，但 `PersonaConfig` 語意是「設定結果」，混入「流程進度」會髒掉，且跳過次數、提問日期會一路長出欄位 |
| C. 全交給 LLM 主導流程 | 對話最自然，但無法保證四件事一定問到、無法測。且 prompt 是產品規格（改動須進 `VERSIONS.prompt`），流程一調就要動版本號 |

採 A 的深層理由：這個 codebase 的既有分工是「規則層決定做什麼，LLM 只做理解這句話」——
安全規則刻意用關鍵字比對而非 LLM（`safety-rule.service.ts` 檔頭），
守護者拿不到聊天原文是結構性保證而非執行期過濾。把流程控制放進 prompt 等於放棄強制點。

## 4. 模組與邊界

新增 `src/modules/onboarding/`：

| 檔案 | 職責 |
|---|---|
| `onboarding.service.ts` | 狀態機。決定下一題、收答案、判斷完成／跳過 |
| `onboarding.steps.ts` | 四步的題目文字、快速回覆選項、預設值。純資料，無邏輯 |
| `onboarding-session.repository.ts` | 讀寫 session |
| `onboarding.module.ts` | 匯出 `OnboardingService` |

### 4.1 刻意不注入的東西

`OnboardingService` **不注入** `ConversationService`，也**不注入** `MessageRepository`。

精靈問答不寫進 `message` 表 —— 那是生活訊號的來源。
「你想叫我什麼名字」不是生活訊號，混進去會污染 Baseline
（同類教訓見 `POSITIVE_SIGNAL_VALUES`：負向訊號值曾被算成正向而灌高基線）。

不注入 `ConversationService` 的作用見 §6：安全規則命中時精靈「讓路」而非「代理」。

## 5. 資料表

新表 `onboarding_session`，一位長者一列。

| 欄位 | 型別 | 用途 |
|---|---|---|
| `id` | uuid PK | |
| `elder_id` | uuid UNIQUE, FK → elder ON DELETE CASCADE | 一人一列 |
| `step` | varchar(16) | `template` / `name` / `salutation` / `initiative` / `preview` / `done` / `stopped` |
| `draft` | jsonb NOT NULL DEFAULT `'{}'` | 累積的答案 |
| `ask_count` | int NOT NULL DEFAULT 0 | 主動開啟過幾次，上限 3 |
| `last_asked_on` | date NULL | 同一天不重複提 |
| `created_at` / `updated_at` | timestamptz | |

`ON DELETE CASCADE`：刪除權（交接規格第 3 節）要能把長者資料整包刪掉。
`onboarding_session` 不是 append-only 表，不受 `app.erase_mode` 那條路徑影響。

**為什麼 draft 不邊答邊寫進 `PersonaConfig`**：`persona_config_history` 每次變更留一筆
（`persona.service.ts` `upsert`）。邊答邊寫會讓一次設定產生四筆歷史，
長者要「還原」時看到一堆雜訊。四步答完一次寫入 = 一次設定一組紀錄。

`last_asked_on` 的日界沿用專案現況（UTC，台灣時間 08:00 換日）。
這是已知技術債，與 `occurred_on` 等欄位一併待改 Asia/Taipei，見 `docs/HANDOFF.md`。
對「同一天不重複提」這個用途，日界偏移無實質影響。

## 6. 狀態轉移

```
(無 session) ─觸發→ template → name → salutation → initiative → preview
                        │                                          │
        「等一下再說」 ─┴──────────────────────────→ stopped        ├─「喜歡」→ done
                                                       │            └─「換一種」→ 換下一個 Template
                              (下次符合條件再提，回到當時的 step)        重跑 preview，最多 2 次
```

### 6.1 「換一種」只輪替 Template

SRS E-00A 要求「喜歡／換一種的**低負擔**調整」。重跑四題不算低負擔。
名字與稱呼是身分，Template 才是語氣 —— 所以「換一種」只在四個 Template 間輪替並重跑
Preview，不重問名字與稱呼。連換 2 次後第 3 次自動 `done`，避免無限迴圈。

Preview 沿用既有 `PersonaService.preview()`（`LlmPort.personaPreview`），不新增路徑。
Preview 這一步的快速回覆為「喜歡」／「換一種」，與 SRS E-00A 的用語一致。

### 6.2 觸發條件

兩個入口，都收斂到 `OnboardingService.ensureSession()`：

1. `follow` 事件自動建檔後，直接開精靈
2. 既有長者：`persona.elderSalutation === elder.displayName` 且無 session → 開精靈

條件 2 的判準是「稱呼等於 LINE 顯示名稱」＝ 從來沒人問過。
已經好好設定過的長者不會被騷擾；開發測試帳號（顯示名稱「Tina 王文利」）剛好落在此條件內，
不必手動清資料庫。

`ensureSession()` 不覆蓋既有 `draft` —— 封鎖後再加好友會從當時的 step 續接。

### 6.3 `autoRegister` 不再拿 LINE 顯示名稱當稱呼

精靈可跳過（§2.2），所以跳過的長者會維持自動建檔時寫入的稱呼。
若那份預設值仍是 LINE 顯示名稱，本案的問題對「跳過的人」等於沒解決。

因此 `ingest.processor.ts` `autoRegister` 改為 `elderSalutation: '您'`。
「您」中性且自然，是安全的退路；「Tina 王文利」不是。

`Elder.displayName` 仍存 LINE 名稱 —— 守護者端需要它辨識是誰
（`guardian-view.service.ts`、`me.controller.ts`），只是不再兼任稱呼。

同一理由，follow 事件的問候不再用顯示名稱組句
（現行 `${created.displayName}你好`）。改為自我介紹與第一題合併成一則推播，
避免加好友瞬間連發兩則訊息。

此變更不影響 §6.2 條件 2：既有資料列的 `elderSalutation` 仍等於 `displayName`，
補跑判準照常成立。新建立的長者在 follow 當下就有 session，不倚賴該判準。

## 7. 四步的題目

題目文字與選項放 `onboarding.steps.ts`，純資料。

| 步 | 問法 | 快速回覆按鈕 | 寫入欄位 | 預設值 |
|---|---|---|---|---|
| `template` | 你希望我平常是什麼樣子？ | 四種 Template 的白話名 | `templateKey` | `companion` |
| `name` | 你想叫我什麼名字？ | 小安 / 小美 / 阿好 | `personaName` | `小安` |
| `salutation` | 我要怎麼叫你比較習慣？ | 阿姨 / 先生 / 女士 | `elderSalutation` | `您` |
| `initiative` | 我可以偶爾主動關心你嗎？ | 可以常常 / 偶爾就好 / 我找你再說 | `initiativeLevel` | `medium` |

`LinePushMessage.quickReplies` 已完整接到 LINE 快速回覆按鈕（`line.adapter.ts` `push`，上限 13）。

按鈕是給「一時想不出來」的人用的；**自由回答（打字或語音）是主路徑** ——
「就叫我阿姨啦」必須能解析。

新增 `LlmPort.parseOnboardingAnswer(step, utterance)` → `{ value, confidence }`，
fake adapter 給決定性實作供測試。`VERSIONS.prompt` 由 `prompt-v2.2` 進到 `prompt-v2.3`
（prompt 文字每次變更都要進版）。

## 8. 資料流

```
LINE webhook → IngestQueue → IngestProcessor.process()
  ├─ follow → autoRegister → onboarding.ensureSession() → push 第一題
  ├─ text  → respondTo(elder, text)
  └─ audio → STT →（信心 < 0.75 走既有「沒聽清楚」）→ respondTo(elder, transcript)

respondTo(elder, text):
  const r = await onboarding.handleTurn({ elderId, utterance: text })
  r.handled ? line.push({ text: r.reply, quickReplies: r.quickReplies })
            : conversation.handleTurn(...)      ← 既有路徑，一行不動
```

`handleText` 與 `handleAudio` 目前各自呼叫 `conversation.handleTurn`，
需抽成共用的 `respondTo` —— 否則語音回答精靈會漏接。

### 8.0 語音路徑的寫入順序要調整

`handleAudio` 目前在路由**之前**就 `messages.append`（成功轉寫的那一段）。
若不動，精靈的語音回答仍會進 `message` 表，§4.1 的邊界在語音路徑上就是破的。

**路由判斷必須提前到 append 之前**：精靈接管的回合不寫 `message`。

低信心（< 0.75）那筆 `messages.append` 照舊寫入 —— 它 `text` 為 null，
記的是 STT 品質而非對話內容，不會污染 Baseline，也是既有 STT 品質追蹤的資料來源。

### 8.1 安全規則優先

`handleTurn` 回 `{ handled: false }` 的三種情況：

1. 沒有進行中的 session
2. **安全規則命中**
3. session 為 `stopped`，且今天已提過或 `ask_count` 已達 3

第 2 條是關鍵。`OnboardingService` 自己注入 `SafetyRuleService` 判斷，命中就回
`handled: false` **讓路**給 `ConversationService` —— 它已有完整安全流程
（通知守護者 + audit + 安全回應，`conversation.service.ts` `handleSafetyHits`）。

這樣 `ConversationService` 一行都不用改。核心對話路徑不順手動。

交接規格 §4：「高風險語句命中不等 Pattern，立即通知並進人工佇列，不受安靜時段限制。」
精靈進行中不是這條規則的例外 —— 長者在第二步說「胸口悶」，
不能回「請問你要叫我什麼名字？」。

### 8.2 稽核

精靈問答不進 `message` 表，但 `onboarding.complete` 與 `onboarding.stopped` **要進 `audit_log`**。
persona 變更本來就會寫 audit（`persona.service.ts` `upsert`），
設定來源是精靈還是手動必須分得出來。

## 9. 錯誤處理

| 情況 | 處理 |
|---|---|
| LLM 解析失敗／超時 | 降級為按鈕字面值比對（按鈕送出的 text 即 label 本身）。比對不到重問一次，第二次仍失敗**用預設值往下走**並記 log |
| 語音沒聽清楚（信心 < 0.75） | 走既有流程，**不推進 step** —— 不會因為聽錯把名字設成亂碼 |
| 精靈中傳圖片 | 不接管，走既有 OCR 流程。藥袋比設定重要 |
| 寫入 `PersonaConfig` 失敗 | session 不推進到 `done`，`draft` 保留，下次繼續 |
| 封鎖後再加好友 | `ensureSession` 不覆蓋 `draft`，從當時的 step 續接 |

貫穿原則：**精靈絕不能讓長者卡在門口**。任何無法解析的狀況最終都走預設值往前，
不原地打轉。這是 §2.2「可跳過」決定的延伸。

## 10. 測試

新增 `test/product-rules/onboarding-wizard.spec.ts`（歸在 product-rules，
因為它釘的是產品原則而非實作細節）。沿用既有模式：repository 用 jest 假物件，不連資料庫。

1. **安全規則優先** — session 進行中說「胸口悶」→ `handled: false` 且 step 不變
2. **一次寫入** — 四步走完後 `persona_config_history` 是一批，不是分四次
3. **不寫 message 表** — 精靈接管的回合不寫入（文字與成功轉寫的語音皆然）；
   低信心語音那筆仍寫入
4. **可跳過** — 「等一下再說」→ `stopped`，下一句正常進 `ConversationService`
5. **再提上限** — `ask_count` 達 3 之後不再主動提
6. **補跑條件** — `elderSalutation === displayName` 才建 session；已設定過的不建
7. **低信心降級不卡住** — LLM 連兩次低信心 → 用預設值往下走，不停在同一步
8. **「換一種」上限** — 連按 2 次後第 3 次自動 `done`

`test/di-graph.spec.ts` 加入 `OnboardingModule` —— 少 import 一個模組是重構最常見的破壞。

## 11. 不做的事

- 第三步「聲音／形象」與 TTS（§2.1）
- 守護者端「協助設定 Persona」入口（SRS 8.2 有要求，但兩條路寫入同一份 persona
  需處理併發與覆蓋順序，另案處理）
- 長者主動說「我要重新設定」重啟精靈（E-00B 已能調語氣，稱呼由 §2.3 補上即足夠）
- LIFF 長者端網頁
