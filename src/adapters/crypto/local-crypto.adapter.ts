import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoPort } from 'src/ports/crypto.port';

const PREFIX = 'v1:local:';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * 本機開發用的欄位級加密。AES-256-GCM，金鑰來自環境變數。
 *
 * 正式環境必須改用 KmsCryptoAdapter —— 見交接規格第 7 節。
 * 這個實作在 NODE_ENV=production 時會拒絕啟動。
 */
@Injectable()
export class LocalCryptoAdapter implements CryptoPort {
  private readonly logger = new Logger(LocalCryptoAdapter.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    if (config.get<string>('env') === 'production') {
      throw new Error(
        'LocalCryptoAdapter 不可用於正式環境。請設定 CRYPTO_PROVIDER=kms（交接規格 §7）。',
      );
    }

    const raw = config.get<string>('crypto.localKey') ?? '';
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error('CRYPTO_LOCAL_KEY 必須是 base64 編碼的 32 bytes 金鑰');
    }
    this.key = key;
    this.logger.warn('使用本機加密金鑰。僅限開發環境。');
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  async decrypt(value: string): Promise<string> {
    if (!value.startsWith(PREFIX)) {
      // 不猜、不回傳原字串 —— 靜默失敗會讓密文外洩到 API 回應。
      throw new Error(`密文前綴不符，無法以 local provider 解密：${value.slice(0, 16)}…`);
    }
    const [iv, tag, ciphertext] = value.slice(PREFIX.length).split(':');
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  isEncrypted(value: string): boolean {
    return value.startsWith('v1:');
  }
}
