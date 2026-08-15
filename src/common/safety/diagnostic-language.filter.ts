import { Injectable } from '@nestjs/common';
import { DiagnosticLanguageError } from 'src/common/errors/product-rule.errors';

/**
 * 診斷式語言攔截。
 *
 * 交接規格 §6：「系統不輸出診斷、不評估傷勢、不做健康判讀。」
 * SRS F2-02：「不得使用『可能罹患…』『疑似失智』等診斷式語言。」
 *
 * LLM 輸出無法靠 prompt 保證，所以在寫入 pattern_alert / weekly_digest
 * 與推播之前一律過這道檢查。命中即拋錯，不做自動改寫 ——
 * 悄悄改寫會讓問題被藏起來，該修的是 prompt。
 */

const DIAGNOSTIC_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /可能罹患|疑似罹患|恐罹患/, label: '可能罹患' },
  { pattern: /疑似(失智|憂鬱|中風|骨折|感染)/, label: '疑似疾病' },
  { pattern: /診斷為|確診|判定為.{0,4}症/, label: '診斷結論' },
  { pattern: /(輕微|嚴重|中度)(骨折|扭傷|挫傷|外傷)/, label: '傷勢評估' },
  { pattern: /建議就醫檢查是否/, label: '引導式判讀' },
  { pattern: /(血糖|血壓|膽固醇).{0,4}(偏高|偏低|過高|過低|異常)/, label: '健康數值判讀' },
  { pattern: /有.{0,6}的風險/, label: '風險預測' },
  { pattern: /失智|憂鬱症|阿茲海默/, label: '疾病名稱' },
];

export interface FilterResult {
  clean: boolean;
  matched: string[];
}

@Injectable()
export class DiagnosticLanguageFilter {
  inspect(text: string): FilterResult {
    const matched = DIAGNOSTIC_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
      ({ label }) => label,
    );
    return { clean: matched.length === 0, matched };
  }

  /** 寫入或推播前呼叫。命中即拋錯。 */
  assertClean(text: string): void {
    const result = this.inspect(text);
    if (!result.clean) {
      throw new DiagnosticLanguageError(result.matched);
    }
  }
}
