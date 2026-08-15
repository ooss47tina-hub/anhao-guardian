# 營運 / Review Console — 設計

- 日期：2026-08-15
- 對應規格：《工程交接規格 v1.0》第 3 節 `/admin/*`、第 6 節不可讓步原則；《SRS v2.1》第 5 節 Review Console
- 範圍：`/admin/*` 的認證，加上一個後端直出的營運後台畫面。含一個新端點與一項既有安全缺陷的修正。

## 1. 為什麼要做

`/admin/*` 已有四組端點（低信心訊號抽查、藥品覆核、外部整合狀態、品質指標），
但**沒有任何畫面，也沒有任何認證**（`admin.controller.ts` 自己標了 `TODO(auth)`）。

同時，營運方目前沒有任何方式看到「系統裡有哪些長者、狀況如何」——
現行唯一的辦法是直接下 SQL。

## 2. 可見性分層

三層，本設計只補中間那層的介面：

| 層 | 看得到 | 看不到 | 現況 |
|---|---|---|---|
| 守護者 | 狀態、四維度對照、週摘要、醫療行程 | **聊天原文**（結構性保證：`GuardianViewService` 不注入 `MessageRepository`） | :3001 五頁已完成 |
| 營運 / Review | 上述 + 低信心訊號的 `evidence` 原句片段、藥品覆核佇列、品質指標、長者總覽 | **完整對話原文** | API 部分存在，無畫面無認證 |
| 長者本人 | 全部 | — | 匯出／刪除 API 已完成 |

### 2.1 為什麼營運層看得到 evidence 但看不到完整對話

`life_signal.evidence` 的欄位定義就是「原句中的依據片段，供 Console 抽查對照」
（`conversation.entities.ts`）。這是規格刻意開的口子，SRS 第 11 節的
「Signal Precision ≥ 85%」驗收沒有它做不到。

完整對話原文則不同。交接規格 §6 的九條不可讓步原則含「無即時定位、無全程行程追蹤、
**無原始數據牆**」；長者的 consent scope（core / medical / pattern_share /
voice_retention / mood_share / raw_chat_share）也沒有任何一項是
「同意營運方讀我的對話」。

`message.text` 是欄位級加密存放（`message.repository.ts` 走 `CryptoPort`）。
營運後台不解密、不提供讀取路徑。要開這一格需要先有法務基礎與新的 consent 條款。

## 3. 認證

`AdminAuthGuard` + `ADMIN_TOKEN` 環境變數（經 `configuration.ts` 註冊為 `admin.token`，
與 `line.provider`、`rules.sttMinConfidence` 等既有設定同一套做法）。

登入頁輸入 token → 存 httpOnly cookie。

**不走 LINE 登入**：營運方不一定有 LINE 帳號；且 admin 權限綁在個人 LINE 身分上，
人員異動時難以收回。

Guard 套在 `@Controller('admin')` **整個 controller**，不是逐個端點掛 ——
少套一個端點就開一個洞，而漏掛不會有任何錯誤訊息。

### 3.1 與 `/dev` 的關鍵差異

`/dev` 在 production 不載入模組，`DevController` 內另有 404 雙保險
（`app.module.ts`、`dev.controller.ts` `assertDev`）。

`/admin` **必須在 production 可用** —— 它就是營運後台。
因此不能沿用環境 gating，**認證是唯一的門**，沒有第二道保險。
這是照抄 `/dev` 實作時最容易出錯的地方。

### 3.2 順帶修正：`reviewerId` 目前可偽造

`ReviewDto.reviewerId` 與 `VerifyMedicationDto.reviewerId` 是呼叫端從 body 傳入的
（`admin.controller.ts`）。任何人都可以宣稱自己是任何審查員，
而這個值會寫進 `signal_review` 與 `audit_log`。

加認證後 `reviewerId` 一律取自登入身分，body 欄位移除。
稽核紀錄若可由呼叫端自行宣稱，等於沒有稽核。

### 3.3 Admin 讀取要留痕

讀取 `evidence` 的操作寫入 `audit_log`（誰、何時、看了哪位長者）。
最高權限看得比守護者多，就要留得比守護者多。

## 4. 端點

| 端點 | 狀態 | 說明 |
|---|---|---|
| `GET /admin` | 新 | 後台頁面（HTML 直出） |
| `POST /admin/login` | 新 | 驗 token，發 httpOnly cookie |
| `GET /admin/elders` | 新 | 長者總覽 |
| `GET /admin/medications/pending` | 新 | 待覆核藥品項目清單 |
| `GET /admin/review/queue` | 已有 | 低信心訊號抽查佇列 |
| `POST /admin/review/:signalId` | 已有（改 `reviewerId` 來源） | 正確／修正／捨棄 |
| `POST /admin/medications/:itemId/verify` | 已有（改 `reviewerId` 來源） | 確認藥名劑量 |
| `GET /admin/quality` | 已有 | 品質指標 |
| `GET /admin/integrations` | 已有 | 外部來源狀態 |

### 4.1 `GET /admin/elders`

每列回傳：

```
display_name / status / 訊息數 / 訊號數 / Baseline 進度 / 綁定守護者數 / 最後互動時間
```

Baseline 進度取自既有的 `BaselineService.gate(elderId, asOf)`，
它回傳 `{ canDetect, effectiveDays, requiredDays }` —— 正好是「還差幾天才能判斷」。

**不回傳任何 `message.text`**，只回數量。這是 §2.1 那條界線在 API 上的落點。

### 4.2 `GET /admin/medications/pending`

`MedicationService` 目前只有 `pendingCount(elderId)`，沒有列出項目的方法，需新增。

交接規格 §6：「藥名與劑量未經人工確認不可建立用藥提醒。」
沒有這個清單，人工確認這一關實務上做不到。

## 5. 畫面

`src/modules/admin/admin-console.html.ts`，沿用 `/dev` 的做法：
controller 回傳 HTML 常數字串，頁面再打 JSON 端點取資料。

四個分頁：

| 分頁 | 資料來源 | 互動 |
|---|---|---|
| 長者總覽 | `GET /admin/elders` | 無 |
| 訊號抽查 | `GET /admin/review/queue` | 正確／修正／捨棄 |
| 藥品覆核 | `GET /admin/medications/pending` | 確認藥名劑量 |
| 系統狀態 | `GET /admin/quality` + `/admin/integrations` | 無 |

這是內部工具，不需要漂亮。將來要升級成獨立前端專案時 API 都在，換皮即可。

品質指標頁面**不顯示聊天次數與 Dashboard 瀏覽量** ——
交接規格 §6 明列不以此為指標，`admin.controller.ts` `quality()` 的註解已寫明
「提供了就會有人拿去看」。畫面同此原則。

## 6. 測試

新增 `test/product-rules/admin-auth.spec.ts`：

1. **每一個 `/admin/*` 端點無 token 一律 401** —— 用 NestJS 反射列出 controller
   所有 route 逐一測，而非手寫清單。新增端點時不會漏掛 Guard 而測試仍綠
2. **`reviewerId` 取自登入身分** —— body 帶了不同的 id 也無效，寫入
   `signal_review` 的仍是登入者
3. **`GET /admin/elders` 不含 `message.text`** —— 回應序列化後不得出現任何訊息內容
4. **讀取 evidence 寫入 audit_log**

`test/di-graph.spec.ts` 已含 `AdminModule`，新增依賴時該測試會自動涵蓋。

## 7. 不做的事

- 完整對話原文的讀取路徑（§2.1，需法務基礎與新 consent 條款）
- 多個 admin 帳號與角色細分（單一 `ADMIN_TOKEN` 足夠當前規模；
  真正需要時應換成正式 IdP，而不是自建使用者表）
- 派單與拆帳（交接規格 §3 明列不含）
- 獨立前端專案
