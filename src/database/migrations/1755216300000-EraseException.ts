import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * append-only 的唯一例外：長者行使刪除權。
 *
 * 兩條產品原則在此互斥：
 * - §2.1 / §2.4：consent 與 audit_log 為 append-only
 * - §6：「長者可要求匯出或刪除全部資料；刪除後不得保留可還原副本」
 *
 * 沒有這個例外，`DELETE FROM elder` 會被 consent 的級聯刪除擋下，
 * 刪除權就形同虛設。
 *
 * 例外的範圍刻意壓到最小：
 * 1. 只放行 DELETE。UPDATE 永遠沒有正當理由 —— 改寫既有授權紀錄就是竄改。
 * 2. 需要交易內的旗標 app.erase_mode，由 PrivacyService.confirmErase 設定。
 *    set_config 的第三個參數為 true，代表交易結束即失效，不會外洩到其他連線。
 * 3. audit_log 不受此影響 —— 它沒有指向 elder 的外鍵，不會被級聯刪除。
 *    「誰在什麼時候刪了什麼」本身是合規要求，且紀錄裡只有 id、沒有個資。
 */
export class EraseException1755216300000 implements MigrationInterface {
  name = 'EraseException1755216300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND current_setting('app.erase_mode', true) = 'on' THEN
          RETURN OLD;
        END IF;

        RAISE EXCEPTION
          '% 為 append-only 資料表，不允許 %（工程交接規格 §2.1 / §2.4）',
          TG_TABLE_NAME, TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION
          '% 為 append-only 資料表，不允許 %（工程交接規格 §2.1 / §2.4）',
          TG_TABLE_NAME, TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql`);
  }
}
