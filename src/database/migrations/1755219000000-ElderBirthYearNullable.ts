import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * elder.birth_year 改為可為空。
 *
 * 加好友自動建檔時還不知道長者幾歲 —— E-00 精靈問過才會有。
 * 原本 NOT NULL 逼得程式要填一個假值，而假的出生年會被當成真的
 * 拿去做年齡相關判斷（例如國健署 65 歲以上健檢資格）。
 *
 * 未知就是 null，讓需要年齡的程式碼被迫顯式處理，而不是拿到一個看似合理的錯誤答案。
 */
export class ElderBirthYearNullable1755219000000 implements MigrationInterface {
  name = 'ElderBirthYearNullable1755219000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE elder ALTER COLUMN birth_year DROP NOT NULL`);
    // 先前為了繞過 NOT NULL 而填入的 0，一律視為未知。
    await q.query(`UPDATE elder SET birth_year = NULL WHERE birth_year = 0`);
    await q.query(`COMMENT ON COLUMN elder.birth_year IS
      '出生年。未經 E-00 精靈確認前為 NULL —— 不得以假值填充'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE elder SET birth_year = 0 WHERE birth_year IS NULL`);
    await q.query(`ALTER TABLE elder ALTER COLUMN birth_year SET NOT NULL`);
  }
}
