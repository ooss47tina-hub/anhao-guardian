export const MY_HEALTH_BANK_PORT = Symbol('MyHealthBankPort');

/**
 * 健康存摺 MyHealthBank（健保署）。
 * OAuth 2.0 + FHIR R4，長者本人健保卡認證。
 *
 * 交接規格第 5 節限制：
 * - 僅存必要欄位，原始 JSON 不落地
 * - 數值原樣呈現，不做衍生判讀
 * - 異常值「不」觸發家人通知
 *
 * TODO(business)：正式介接資格與申請流程待商務與法務確認。
 */
export interface HealthRecordLab {
  name: string;
  /** 原樣字串，不轉數字、不做單位換算、不加註「偏高／偏低」。 */
  value: string;
  unit: string | null;
}

export interface HealthRecordSnapshot {
  examDate: string;
  labs: HealthRecordLab[];
  /** 前端據此標註「資料未即時更新」（交接規格 2.4 gov_health_record）。 */
  dataAsOf: string;
}

export interface MedicalVisitRecord {
  visitAt: string;
  hospital: string;
  department: string | null;
}

export interface MyHealthBankPort {
  /** 以長者健保卡認證取得的 token 換取健檢紀錄。 */
  fetchHealthRecords(elderToken: string): Promise<HealthRecordSnapshot[]>;

  fetchMedicalVisits(elderToken: string): Promise<MedicalVisitRecord[]>;

  /** 授權是否仍有效。到期者停止取用並發重新授權請求（交接規格第 4 節）。 */
  isAuthorizationValid(elderToken: string, expiresAt: Date | null): boolean;
}
