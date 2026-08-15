export const HPA_ELIGIBILITY_PORT = Symbol('HpaEligibilityPort');

/**
 * 成人預防保健資格（國健署）。REST + API Key，個資最小化查詢。
 *
 * 交接規格第 5 節：僅回傳今年份可用／已用與上次日期。
 * 失敗時以「上次日期 + 1 年」推算並標 degraded。
 */
export interface EligibilityResult {
  program: string;
  year: number;
  available: boolean;
  lastUsedDate: string | null;
  /** true 表示由「上次日期 + 1 年」推算而非 API 實查（交接規格 2.4）。 */
  degraded: boolean;
}

export interface HpaEligibilityPort {
  /**
   * 查詢資格。
   * 實作必須做個資最小化 —— 只送必要識別欄位，不送姓名、地址、完整身分證號。
   */
  checkEligibility(input: { elderToken: string; program: string; year: number }): Promise<EligibilityResult>;
}
