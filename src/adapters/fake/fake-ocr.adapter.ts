import { Injectable } from '@nestjs/common';
import { MedicalOcrResult, OcrPort } from 'src/ports/ocr.port';

/**
 * 假 OCR。回傳固定的回診單內容，藥品一律 needs_human_review。
 *
 * 這個假實作不提供「跳過人工確認」的旁路 —— 交接規格第 6 節列為產品原則，
 * 測試環境放行等於讓正式環境有機會放行。
 */
@Injectable()
export class FakeOcrAdapter implements OcrPort {
  async readMedicalDocument(_image: { ref: string; mimeType: string }): Promise<MedicalOcrResult> {
    return {
      nextVisitAt: '2026-09-16T09:30:00+08:00',
      hospital: '慈濟醫院',
      department: '骨科',
      doctor: '王醫師',
      medications: [
        {
          ocrRaw: '普拿疼 500mg 一日三次 飯後服用',
          guessedDrugName: '普拿疼',
          guessedDosage: '500mg 一日三次',
          needsHumanReview: true,
        },
        {
          ocrRaw: '骨鈣寧 一日一次 睡前',
          guessedDrugName: '骨鈣寧',
          guessedDosage: '一日一次',
          needsHumanReview: true,
        },
      ],
      confidence: 0.81,
    };
  }
}
