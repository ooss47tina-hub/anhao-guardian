import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoPort } from 'src/ports/crypto.port';

const PREFIX = 'v1:kms:';

/**
 * 正式環境的欄位級加密（交接規格第 7 節）。
 *
 * TODO(infra)：接上雲端 KMS。建議做法是 envelope encryption —— KMS 保管 CMK，
 * 每筆資料產生 DEK 加密內容，DEK 以 CMK 加密後與密文同存，避免每次讀寫都打 KMS。
 * 部署於 GCP/AWS 台灣區域（SRS 3.2）。
 */
@Injectable()
export class KmsCryptoAdapter implements CryptoPort {
  private readonly keyId: string;

  constructor(config: ConfigService) {
    this.keyId = config.get<string>('crypto.kmsKeyId') ?? '';
    if (!this.keyId) {
      throw new Error('CRYPTO_PROVIDER=kms 時必須設定 CRYPTO_KMS_KEY_ID');
    }
  }

  async encrypt(_plaintext: string): Promise<string> {
    throw new Error('KmsCryptoAdapter 尚未實作。見 TODO(infra)。');
  }

  async decrypt(_ciphertext: string): Promise<string> {
    throw new Error('KmsCryptoAdapter 尚未實作。見 TODO(infra)。');
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX) || value.startsWith('v1:');
  }
}
