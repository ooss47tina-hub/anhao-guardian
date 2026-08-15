export const OCR_PORT = Symbol('OcrPort');

/**
 * 回診單／藥袋辨識結果。
 *
 * 交接規格第 3 節 POST /v1/ocr/medical：「藥名劑量一律標 needs_human_review」。
 * 這個型別刻意不提供「已驗證」的藥品欄位 —— 驗證狀態只存在 medication_item，
 * 由人工佇列寫入，OCR 端無法產生。
 */
export interface MedicalOcrResult {
  /** 下次回診日期。可為 null（照片上沒有）。 */
  nextVisitAt: string | null;
  hospital: string | null;
  department: string | null;
  doctor: string | null;

  /** 藥品原始辨識文字。一律 needs_human_review，不得直接建立提醒。 */
  medications: Array<{
    ocrRaw: string;
    guessedDrugName: string | null;
    guessedDosage: string | null;
    needsHumanReview: true;
  }>;

  /** 整張圖的信心值，供前端決定「請確認」的措辭強度。 */
  confidence: number;
}

export interface OcrPort {
  readMedicalDocument(image: { ref: string; mimeType: string }): Promise<MedicalOcrResult>;
}
