import { ConfigService } from '@nestjs/config';
import { LocalCryptoAdapter } from 'src/adapters/crypto/local-crypto.adapter';

/**
 * 交接規格 §2.2、§7：message.text 與 gov_health_record.payload 欄位級加密。
 */
describe('欄位級加密', () => {
  const key = Buffer.from('anhao-test-key-32-bytes-exactly!').toString('base64');

  function config(overrides: Record<string, string> = {}): ConfigService {
    const values: Record<string, string> = {
      env: 'development',
      'crypto.localKey': key,
      ...overrides,
    };
    return { get: (k: string) => values[k] } as ConfigService;
  }

  it('加解密可還原', async () => {
    const crypto = new LocalCryptoAdapter(config());
    const plaintext = '我剛剛在浴室滑了一下';

    const ciphertext = await crypto.encrypt(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(crypto.isEncrypted(ciphertext)).toBe(true);
    expect(await crypto.decrypt(ciphertext)).toBe(plaintext);
  });

  it('相同明文每次密文不同（隨機 IV）', async () => {
    const crypto = new LocalCryptoAdapter(config());
    const a = await crypto.encrypt('今天去市場');
    const b = await crypto.encrypt('今天去市場');
    expect(a).not.toBe(b);
  });

  it('密文被竄改時解密失敗，不回傳垃圾', async () => {
    const crypto = new LocalCryptoAdapter(config());
    const ciphertext = await crypto.encrypt('今天去市場');
    const tampered = ciphertext.slice(0, -4) + 'AAAA';

    await expect(crypto.decrypt(tampered)).rejects.toThrow();
  });

  it('非本 provider 的密文不得被靜默當成明文回傳', async () => {
    const crypto = new LocalCryptoAdapter(config());
    await expect(crypto.decrypt('v1:kms:key-1:abcdef')).rejects.toThrow(/前綴不符/);
  });

  it('正式環境拒絕使用本機金鑰（交接規格 §7 要求 KMS）', () => {
    expect(() => new LocalCryptoAdapter(config({ env: 'production' }))).toThrow(
      /不可用於正式環境/,
    );
  });

  it('金鑰長度不足時拒絕啟動', () => {
    expect(() => new LocalCryptoAdapter(config({ 'crypto.localKey': 'dG9vLXNob3J0' }))).toThrow(
      /32 bytes/,
    );
  });
});
