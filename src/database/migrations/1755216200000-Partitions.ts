import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 分區維護。
 *
 * 交接規格 §7：「life_signal 與 baseline_snapshot 資料量隨時間線性成長，
 * 建議按 elder_id 與月份分區。」
 *
 * 實作採月份 RANGE 分區。未按 elder_id 再做 hash 子分區的理由：
 * 查詢一律帶 elder_id 且已有 (elder_id, occurred_on) 索引，月分區已足以讓
 * 舊資料可整批 detach 歸檔；兩層分區會讓分區數量在兩年內破千，維運成本大於收益。
 * 若單一長者資料量超出預期，再補 hash 子分區即可，不影響查詢介面。
 */
export class Partitions1755216200000 implements MigrationInterface {
  name = 'Partitions1755216200000';

  public async up(q: QueryRunner): Promise<void> {
    /**
     * 建立指定月份的分區。缺分區會讓 INSERT 直接失敗，
     * 所以 ensure_monthly_partitions() 由排程每日呼叫，預先開好未來三個月。
     */
    await q.query(`
      CREATE OR REPLACE FUNCTION create_monthly_partition(
        p_table text, p_column text, p_month date
      ) RETURNS void AS $$
      DECLARE
        start_date date := date_trunc('month', p_month);
        end_date   date := (date_trunc('month', p_month) + interval '1 month');
        part_name  text := format('%s_%s', p_table, to_char(start_date, 'YYYYMM'));
      BEGIN
        IF to_regclass(part_name) IS NOT NULL THEN RETURN; END IF;
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
          part_name, p_table, start_date, end_date);
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`
      CREATE OR REPLACE FUNCTION ensure_monthly_partitions(p_months_ahead int DEFAULT 3)
      RETURNS void AS $$
      DECLARE i int;
      BEGIN
        FOR i IN -1..p_months_ahead LOOP
          PERFORM create_monthly_partition('message', 'created_at',
            (current_date + (i || ' month')::interval)::date);
          PERFORM create_monthly_partition('life_signal', 'occurred_on',
            (current_date + (i || ' month')::interval)::date);
          PERFORM create_monthly_partition('baseline_snapshot', 'computed_on',
            (current_date + (i || ' month')::interval)::date);
        END LOOP;
      END;
      $$ LANGUAGE plpgsql`);

    // 建立當下可用的分區，否則 migration 跑完馬上寫入會失敗。
    await q.query(`SELECT ensure_monthly_partitions(3)`);

    /**
     * DEFAULT 分區作為安全網：時間戳異常的資料不會讓 INSERT 整批失敗，
     * 而是落到這裡，由監控撈出來處理。
     */
    for (const table of ['message', 'life_signal', 'baseline_snapshot']) {
      await q.query(`CREATE TABLE ${table}_default PARTITION OF ${table} DEFAULT`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP FUNCTION IF EXISTS ensure_monthly_partitions(int)`);
    await q.query(`DROP FUNCTION IF EXISTS create_monthly_partition(text, text, date)`);
  }
}
