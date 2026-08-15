import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';

/**
 * 產品原則違反時拋出的錯誤。
 *
 * 交接規格第 6 節：「凡標示『不可』者為產品原則，非技術限制，實作時不得便宜行事。」
 * 這些錯誤刻意不可被 catch 後忽略 —— 每一個都對應一條規格條文，
 * 出現代表呼叫端寫錯了，不是使用者輸入問題。
 */

/** 藥名與劑量未經人工確認不可建立用藥提醒（交接規格 2.4、6；SRS F4-03）。 */
export class HumanReviewRequiredError extends UnprocessableEntityException {
  constructor(subject: string) {
    super({
      code: 'HUMAN_REVIEW_REQUIRED',
      message: `${subject} 未經人工確認，不可建立提醒`,
      specRef: '工程交接規格 §2.4 medication_item / §6；SRS F4-03',
    });
  }
}

/** 有效生活日不足時不可產生「跟平常不一樣」的判斷或家人通知（交接規格 4、6；SRS F2-01）。 */
export class InsufficientBaselineError extends UnprocessableEntityException {
  constructor(effectiveDays: number, required: number) {
    super({
      code: 'INSUFFICIENT_BASELINE',
      message: `有效生活日 ${effectiveDays} 天，未達 ${required} 天，不得產生變化判斷或家人通知`,
      specRef: '工程交接規格 §4 pattern_detect / §6；SRS F2-01',
    });
  }
}

/** 守護者不可取得聊天原文，除非長者個別開啟 raw_chat_share（交接規格 6）。 */
export class RawChatAccessDeniedError extends ForbiddenException {
  constructor() {
    super({
      code: 'RAW_CHAT_ACCESS_DENIED',
      message: '守護者不可取得聊天原文，除非長者個別開啟 raw_chat_share',
      specRef: '工程交接規格 §6',
    });
  }
}

/** 授權範圍一律由長者本人在 LINE 確認；守護者只能提出請求（交接規格 3、6）。 */
export class ElderConsentRequiredError extends ForbiddenException {
  constructor(scope: string) {
    super({
      code: 'ELDER_CONSENT_REQUIRED',
      message: `${scope} 授權需由長者本人在 LINE 確認，守護者只能提出請求`,
      specRef: '工程交接規格 §3 POST /v1/consent / §6',
    });
  }
}

/** 系統不輸出診斷、不評估傷勢、不做健康判讀（交接規格 6；SRS F2-02）。 */
export class DiagnosticLanguageError extends UnprocessableEntityException {
  constructor(matched: string[]) {
    super({
      code: 'DIAGNOSTIC_LANGUAGE_BLOCKED',
      message: `輸出含診斷式語言，已攔截：${matched.join('、')}`,
      specRef: '工程交接規格 §6；SRS F2-02',
    });
  }
}

/** 尚未取得對應 consent scope。 */
export class ConsentScopeDeniedError extends ForbiddenException {
  constructor(scope: string) {
    super({
      code: 'CONSENT_SCOPE_DENIED',
      message: `未取得授權範圍 ${scope}`,
      specRef: '工程交接規格 §2.1 consent',
    });
  }
}
