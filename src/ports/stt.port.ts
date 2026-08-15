export const STT_PORT = Symbol('SttPort');

export interface SttResult {
  /**
   * 轉寫結果。一律台灣繁體中文 —— 模型可能輸出簡體，實作端負責轉換。
   * 轉寫失敗（聽不出內容）時為空字串，由 confidence 表達可信度。
   */
  text: string;

  /**
   * 真實信心值，不得回傳常數。
   * 交接規格 §3：低於 0.75 要求長者重說，不猜語意 —— 這個門檻只有在
   * confidence 真的反映轉寫品質時才有意義。
   */
  confidence: number;

  /** zh-TW。台語列 Phase 1.5（SRS 3.2）。 */
  language: string;
}

export interface SttAudio {
  /**
   * 音檔位元組。
   *
   * 刻意傳 bytes 而非物件儲存的 ref：轉寫需要的是音訊內容，
   * 傳 ref 會逼每個 STT 實作都得知道怎麼讀物件儲存 ——
   * 那是呼叫端的責任，不是轉寫服務的。
   */
  data: Buffer;
  mimeType: string;
  /** 僅供記錄與除錯，實作不得依賴它。 */
  ref?: string;
}

export interface SttPort {
  transcribe(audio: SttAudio): Promise<SttResult>;
}
