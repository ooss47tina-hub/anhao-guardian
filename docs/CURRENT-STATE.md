# 現況與下一步

> 給新對話接手用。開新分頁時把這份檔案的路徑貼給 Claude 即可。
> 最後更新：2026-08-15

## 這是什麼

「安好 AI 自主生活守護」的後端 + 守護者端網頁。依《工程交接規格 v1.0》與
《SRS v2.1 AI Persona》實作（原始文件在 `~/Downloads/`，兩份 HTML 是 bundler
打包的單檔 SPA，內容在 `<script type="__bundler/template">` 的 JSON 裡，
直接 grep HTML 讀不到）。

**規格權威順序**：《工程交接規格 v1.0》>《SRS v2.1》。

專案在 `~/Projects/anhao-guardian`，刻意不放 Google Drive 資料夾（避開同步）。

## 目前狀態

- 10 個 commits，135 個追蹤檔案，110 個測試全過
- 後端 NestJS 11 + PostgreSQL 16 + TypeORM；守護者端 Next.js 16

| 外部串接 | 狀態 |
|---|---|
| LINE Messaging API | ✅ 真串接（可用手機聊天、傳語音） |
| LLM（OpenAI `gpt-5.6-terra`） | ✅ 真串接 |
| STT（OpenAI `gpt-4o-transcribe`） | ✅ 真串接 |
| OCR（藥袋辨識） | ❌ fake |
| 健康存摺 / 國健署 / 社區活動 | ❌ fake |

## 怎麼把環境跑起來

```bash
open -a Docker                                    # 等鯨魚圖示穩定
cd ~/Projects/anhao-guardian && docker compose up -d
npm run start:dev                                 # 後端 :3000
```

另一個終端機：

```bash
cd ~/Projects/anhao-guardian/web && npm run dev    # 守護者端 :3001
```

要讓 LINE 打得進來（webhook）：

```bash
cd ~/Projects/anhao-guardian && npm run line:tunnel   # ngrok
```

⚠️ **ngrok 免費版每次重開網址會變**。變了要到 LINE Developers Console
（<https://developers.line.biz/console/channel/2011119832/messaging-api>）
把 Webhook URL 更新成新的 `https://xxx.ngrok-free.dev/webhook/line`。

資料庫是 Docker volume，重開機不會掉，不用重跑 migration 或 seed。

## 三個可以看的畫面

| | 網址 | 用途 |
|---|---|---|
| 守護者端 | <http://localhost:3001> | G-01～G-05 五頁，正式產品介面 |
| 開發檢視頁 | <http://localhost:3000/dev> | 一鍵切換情境、扮演長者對話、看通知紀錄 |
| LINE | 手機上的「安好」 | 真實長者端體驗（文字 + 語音） |

## 常用指令

```bash
npm test                              # 119 個測試，不需資料庫
npm run seed                          # 示範長者陳美玲 + 守護者陳怡君
npm run seed:history                  # 灌 28 天訊號（worth_attention 情境）
npm run seed:history -- stable        # 或 stable / insufficient
npm run seed:history -- worth_attention U1234...   # 可指定長者（LINE user id）
npm run demo:elder -- <長者LINE id> [守護者LINE id]  # 把真實 LINE 帳號變成故事示範長者
npm run job -- baseline_rebuild       # 手動觸發排程
npm run job -- pattern_detect
npm run job -- digest_build 2026-08-17T09:00:00   # 可指定「假裝現在是」
```

**2026-08-15 demo 設定**：Tina 的真實 LINE 帳號已轉成示範長者「王伯伯」
（74 歲獨居，媳婦視角，worth_attention 情境，P2 已觸發並真推播）。
守護者網頁改用假 id 登入（`web/.env.local` 的
`NEXT_PUBLIC_DEV_TOKEN=id-token:U-demo-guardian-web`）——
因為 LineAuthGuard 先查 elder 表，真實帳號的 token 永遠是長者身分。
LINE 通知推播給主要守護者（目前指到 Tina 自己的 line id；換家人手機時
重跑 `demo:elder` 帶第二個參數）。

示範身分的 token（FakeLineAdapter 格式，開發環境專用）：

- 長者：`Bearer id-token:U-dev-elder-meiling`
- 守護者：`Bearer id-token:U-dev-guardian-yijun`

## 接下來建議做的（依優先序）

1. **E-00 設定精靈** — 現在新使用者加好友後，稱呼直接拿 LINE 顯示名稱
   （實測拿到「Tina 王文利」，AI 每句話這樣叫很怪）。SRS F0-01 要求五步驟
   對話問出「要叫它什麼名字」「它要怎麼叫你」。語音已經接好，精靈可以用講的完成。
2. **OCR** — 藥袋／回診單辨識。同一把 OpenAI key 可用 vision。
   注意藥名劑量一律要人工確認才能建提醒（交接規格 §6，已有測試釘住）。
3. **公部門資料** — 健康存摺需要正式介接資格（待商務法務確認，見交接規格 §7）。
4. **正式部署前必補** — `/admin/*` 無認證、`IngestQueue` 是記憶體內佇列
   （不可多副本）、KMS adapter 未實作、日界為 UTC 應改 Asia/Taipei。
   完整清單在 `docs/HANDOFF.md` 文末。

## 待你決定的事

- **Baseline 門檻規格衝突**：交接規格 §4 = 21 個有效生活日；SRS F2-01 =
  21 天且 12 個有效生活日。目前採較嚴格的交接規格值，做成
  `BASELINE_MIN_EFFECTIVE_DAYS` 環境變數，確認後改設定即可。
- **LINE channel secret 曾出現在對話截圖中**，建議在 LINE 後台重新發行一次。

## 開發過程中學到的（別再踩）

這些是實測才發現、規格上看不出來的：

1. **接真資料庫才會現形**：§6 的刪除權與 §2.1 的 consent append-only 在
   `DELETE FROM elder` 時互斥。解法是 `app.erase_mode` 交易旗標，只放行 DELETE。
2. **NestJS `ValidationPipe({whitelist:true})`** 會把沒有 class-validator
   裝飾器的 DTO 欄位整個剝掉，body 變空且不報錯，之後才炸 500。
3. **Baseline 按維度數筆數、不看 value**：LLM 抽出 `outing=stayed_home`
   會被算成一次外出。已加 `POSITIVE_SIGNAL_VALUES` 白名單，三處查詢共用。
4. **STT 繁簡輸出不穩定**：prompt 導向不可靠（給了「請用繁體」反而輸出簡體），
   改用 opencc 決定性轉換。
5. **STT 聽不清時會漂到日文**，即使指定 `language=zh`。已加字符集檢查。
6. **切到真 LINE 後** `verifyIdToken` 會真的打 LINE 端點，開發用 token 失效。
   已加開發直通（production 拒絕）。

## 重要設計原則（改動前先讀）

交接規格 §6 有九條「不可讓步」的產品原則，每一條都有明確強制點，
對照表在 `README.md` 的「產品原則怎麼被程式強制」。其中最容易破壞的：

- **守護者拿不到聊天原文**是結構性保證 —— `GuardianViewService` 不注入
  `MessageRepository`，`GuardianModule` 不 import `ConversationModule`。
  有測試釘住這個結構。
- **prompt 是產品規格的一部分**，不是實作細節。改 `openai-llm.prompts.ts`
  必須同步進 `VERSIONS.prompt`，否則舊通知無法重現（§6 要求可回溯）。
- **`consent` 與 `audit_log` 是 append-only**，由 DB trigger 強制。
  撤銷授權要走 `revoke_consent()` 插入新列。
