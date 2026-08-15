/**
 * 外部依賴的契約層。
 *
 * 交接規格第 5 節的四個外部來源，加上 LLM / STT / OCR / 物件儲存 / 加密，
 * 一律以 Port 定義契約。src/adapters/fake 提供讀 fixture 的假實作，
 * 所以整套系統不需任何金鑰即可啟動與測試；src/adapters/real 是正式串接位置。
 */
export * from './crypto.port';
export * from './llm.port';
export * from './stt.port';
export * from './ocr.port';
export * from './line.port';
export * from './my-health-bank.port';
export * from './hpa-eligibility.port';
export * from './community-activity.port';
export * from './object-storage.port';
