import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * append-only 強制。
 *
 * 交接規格 §2.1 consent 與 §2.4 audit_log 都標明 append-only。
 * 只靠應用層自律不夠 —— 一次誤用 repository.save() 帶 id 就會靜默覆蓋授權紀錄，
 * 而授權紀錄正是合規稽核時要拿出來的東西。所以在 DB 層直接擋掉。
 *
 * 例外：consent.revoked_at 的回填由 revoke_consent() 函式處理（見下），
 * 它以插入新列表達撤銷，不改舊列。
 */
export class AppendOnlyGuards1755216100000 implements MigrationInterface {
  name = 'AppendOnlyGuards1755216100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION
          '% 為 append-only 資料表，不允許 %（工程交接規格 §2.1 / §2.4）',
          TG_TABLE_NAME, TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql`);

    for (const table of ['consent', 'audit_log']) {
      await q.query(`
        CREATE TRIGGER ${table}_append_only
        BEFORE UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION reject_mutation()`);
    }

    // baseline_snapshot 被 pattern_alert 引用作為事後追溯依據，同樣不得改寫。
    // 分區表的 trigger 要掛在分區上，故改由 rebuild job 以 ON CONFLICT DO NOTHING 保證，
    // 並在此註記，避免接手者以為漏了。
    await q.query(`COMMENT ON TABLE baseline_snapshot IS
      '每日一筆快照，永久保留。分區表無法掛 row-level trigger，改由 baseline_rebuild job
       以 ON CONFLICT DO NOTHING 保證不覆寫（交接規格 §2.3）'`);

    /**
     * 撤銷授權的唯一正確做法。
     * 應用層一律呼叫這個函式，不得自行 UPDATE consent。
     */
    await q.query(`
      CREATE OR REPLACE FUNCTION revoke_consent(
        p_elder_id uuid, p_scope varchar, p_version varchar, p_evidence varchar
      ) RETURNS uuid AS $$
      DECLARE new_id uuid;
      BEGIN
        INSERT INTO consent (elder_id, scope, granted, consent_version, granted_at, revoked_at, evidence_ref)
        VALUES (p_elder_id, p_scope, false, p_version, now(), now(), p_evidence)
        RETURNING id INTO new_id;
        RETURN new_id;
      END;
      $$ LANGUAGE plpgsql`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP FUNCTION IF EXISTS revoke_consent(uuid, varchar, varchar, varchar)`);
    for (const table of ['consent', 'audit_log']) {
      await q.query(`DROP TRIGGER IF EXISTS ${table}_append_only ON ${table}`);
    }
    await q.query(`DROP FUNCTION IF EXISTS reject_mutation()`);
  }
}
