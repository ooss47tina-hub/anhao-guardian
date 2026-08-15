/**
 * 欄位級加密。
 *
 * 交接規格第 7 節：「金鑰管理用雲端 KMS，message.text 與 gov_health_record.payload
 * 欄位級加密。」
 *
 * 密文格式為自描述字串，換 provider 後舊資料仍可解：
 *   v1:local:<iv-b64>:<tag-b64>:<ciphertext-b64>
 *   v1:kms:<keyId>:<ciphertext-b64>
 */
export const CRYPTO_PORT = Symbol('CryptoPort');

export interface CryptoPort {
  /** 加密明文。回傳自描述密文字串。 */
  encrypt(plaintext: string): Promise<string>;

  /** 解密。傳入非本 provider 產生的密文時，須依前綴判斷並拒絕而非回傳垃圾。 */
  decrypt(ciphertext: string): Promise<string>;

  /** 判斷字串是否為本系統產生的密文（用於 migration 與雙寫期間）。 */
  isEncrypted(value: string): boolean;
}
