import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 初始 schema。對應《工程交接規格 v1.0》第 2 節全部資料表。
 *
 * 刻意用手寫 SQL 而非 TypeORM synchronize：分區、trigger、部分索引與 CHECK 條件
 * 都是規格要求的一部分，ORM 產生的 DDL 表達不出來。
 */
export class InitialSchema1755216000000 implements MigrationInterface {
  name = 'InitialSchema1755216000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // ── §2.1 身分與關係 ──────────────────────────────────────
    await q.query(`
      CREATE TABLE elder (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        line_user_id varchar(64) NOT NULL UNIQUE,
        display_name varchar(64) NOT NULL,
        birth_year int NOT NULL,
        living_alone boolean NOT NULL DEFAULT false,
        locale varchar(16) NOT NULL DEFAULT 'zh-TW',
        region_code varchar(16),
        status varchar(16) NOT NULL DEFAULT 'onboarding',
        health_card_token text,
        health_card_token_expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT elder_status_chk
          CHECK (status IN ('onboarding','active','paused','erased'))
      )`);
    await q.query(`COMMENT ON COLUMN elder.health_card_token IS
      '健保卡認證 token。不存卡號與身分證號（交接規格 §2.1）'`);

    await q.query(`
      CREATE TABLE guardian (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        line_user_id varchar(64) NOT NULL UNIQUE,
        display_name varchar(64) NOT NULL,
        phone varchar(32),
        notify_channel varchar(16) NOT NULL DEFAULT 'line',
        quiet_hours_start varchar(5),
        quiet_hours_end varchar(5),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE guardian_link (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL REFERENCES elder(id) ON DELETE CASCADE,
        guardian_id uuid NOT NULL REFERENCES guardian(id) ON DELETE CASCADE,
        relation varchar(32) NOT NULL,
        is_primary boolean NOT NULL DEFAULT false,
        invited_by uuid,
        bound_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz,
        UNIQUE (elder_id, guardian_id)
      )`);

    // 每位長者僅一位 is_primary（交接規格 §2.1）。已解除者不算，故用部分唯一索引。
    await q.query(`
      CREATE UNIQUE INDEX guardian_link_one_primary_idx
        ON guardian_link (elder_id)
        WHERE is_primary AND revoked_at IS NULL`);

    await q.query(`
      CREATE TABLE link_invite (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(16) NOT NULL UNIQUE,
        elder_id uuid REFERENCES elder(id) ON DELETE CASCADE,
        guardian_id uuid REFERENCES guardian(id) ON DELETE CASCADE,
        created_by_role varchar(16) NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT link_invite_role_chk CHECK (created_by_role IN ('elder','guardian'))
      )`);

    await q.query(`
      CREATE TABLE consent (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL REFERENCES elder(id) ON DELETE CASCADE,
        scope varchar(32) NOT NULL,
        granted boolean NOT NULL,
        consent_version varchar(32) NOT NULL,
        granted_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz,
        evidence_ref varchar(128) NOT NULL,
        CONSTRAINT consent_scope_chk CHECK (scope IN
          ('core','medical','pattern_share','voice_retention','mood_share','raw_chat_share'))
      )`);
    await q.query(`CREATE INDEX consent_lookup_idx ON consent (elder_id, scope, granted_at DESC)`);
    await q.query(`COMMENT ON TABLE consent IS
      'append-only。撤銷授權請插入 granted=false 的新列，不得 UPDATE（交接規格 §2.1）'`);

    await q.query(`
      CREATE TABLE persona_config (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL UNIQUE REFERENCES elder(id) ON DELETE CASCADE,
        template_key varchar(32) NOT NULL,
        persona_name varchar(32) NOT NULL,
        elder_salutation varchar(32) NOT NULL,
        voice_id varchar(32),
        avatar_key varchar(32),
        initiative_level varchar(8) NOT NULL DEFAULT 'medium',
        reminder_style varchar(8) NOT NULL DEFAULT 'gentle',
        speaking_speed varchar(8) NOT NULL DEFAULT 'slow',
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT persona_template_chk CHECK (template_key IN
          ('life_assistant','companion','concise','family_bridge')),
        CONSTRAINT persona_initiative_chk CHECK (initiative_level IN ('low','medium','high')),
        CONSTRAINT persona_reminder_chk CHECK (reminder_style IN ('gentle','direct'))
      )`);

    await q.query(`
      CREATE TABLE persona_config_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL REFERENCES elder(id) ON DELETE CASCADE,
        field varchar(32) NOT NULL,
        old_value text,
        new_value text,
        source varchar(16) NOT NULL,
        actor_id uuid,
        changed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT persona_history_source_chk CHECK (source IN ('manual','adaptive'))
      )`);
    await q.query(`CREATE INDEX persona_history_idx ON persona_config_history (elder_id, changed_at DESC)`);

    // ── §2.2 對話與訊號 ──────────────────────────────────────
    // message / life_signal 隨時間線性成長，按月分區（交接規格 §7）。
    await q.query(`
      CREATE TABLE message (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL,
        direction varchar(8) NOT NULL,
        modality varchar(8) NOT NULL,
        text_encrypted text,
        stt_confidence real,
        audio_ref varchar(256),
        image_ref varchar(256),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (id, created_at),
        CONSTRAINT message_direction_chk CHECK (direction IN ('inbound','outbound')),
        CONSTRAINT message_modality_chk CHECK (modality IN ('text','audio','image'))
      ) PARTITION BY RANGE (created_at)`);
    await q.query(`CREATE INDEX message_elder_idx ON message (elder_id, created_at DESC)`);
    await q.query(`COMMENT ON COLUMN message.text_encrypted IS
      '欄位級加密。守護者端不得讀取，除非 raw_chat_share（交接規格 §2.2、§6）'`);

    await q.query(`
      CREATE TABLE life_signal (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL,
        message_id uuid,
        dimension varchar(24) NOT NULL,
        value varchar(64) NOT NULL,
        confidence real NOT NULL,
        extractor_version varchar(32) NOT NULL,
        occurred_on date NOT NULL,
        review_state varchar(16) NOT NULL DEFAULT 'auto_accepted',
        evidence text,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (id, occurred_on),
        CONSTRAINT life_signal_dimension_chk CHECK (dimension IN
          ('interaction','outing','meal','sleep_subjective','social','mood','concern','task')),
        CONSTRAINT life_signal_review_chk CHECK (review_state IN
          ('auto_accepted','pending_review','reviewed')),
        CONSTRAINT life_signal_confidence_chk CHECK (confidence >= 0 AND confidence <= 1)
      ) PARTITION BY RANGE (occurred_on)`);
    await q.query(`CREATE INDEX life_signal_baseline_idx
      ON life_signal (elder_id, occurred_on DESC, dimension)`);
    // 人工抽查佇列的查詢路徑。
    await q.query(`CREATE INDEX life_signal_review_queue_idx
      ON life_signal (confidence) WHERE review_state = 'pending_review'`);

    await q.query(`
      CREATE TABLE signal_review (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        signal_id uuid NOT NULL,
        reviewer_id uuid NOT NULL,
        verdict varchar(16) NOT NULL,
        corrected_value varchar(64),
        reviewed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT signal_review_verdict_chk CHECK (verdict IN ('correct','corrected','discarded'))
      )`);
    await q.query(`CREATE INDEX signal_review_signal_idx ON signal_review (signal_id)`);

    await q.query(`
      CREATE TABLE memory_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL REFERENCES elder(id) ON DELETE CASCADE,
        kind varchar(16) NOT NULL,
        content text NOT NULL,
        source_message_id uuid,
        confirmed_by_elder boolean NOT NULL DEFAULT false,
        confirmed_at timestamptz,
        confidence real NOT NULL DEFAULT 0,
        valid_from timestamptz,
        valid_to timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT memory_kind_chk CHECK (kind IN
          ('preference','relation','routine','place','medical','event')),
        -- confirmed_at 與 confirmed_by_elder 必須一致，避免出現「已確認但沒有時間」的資料
        CONSTRAINT memory_confirm_chk CHECK (
          (confirmed_by_elder = false AND confirmed_at IS NULL) OR
          (confirmed_by_elder = true AND confirmed_at IS NOT NULL))
      )`);
    await q.query(`CREATE INDEX memory_item_idx ON memory_item (elder_id, kind)`);
    // 主動提醒只能用已確認的記憶（交接規格 §2.2）。
    await q.query(`CREATE INDEX memory_item_proactive_idx
      ON memory_item (elder_id) WHERE confirmed_by_elder = true`);

    // ── §2.3 Baseline 與 Pattern ─────────────────────────────
    await q.query(`
      CREATE TABLE baseline_snapshot (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL,
        computed_on date NOT NULL,
        window_days int NOT NULL,
        dimension varchar(24) NOT NULL,
        mean real NOT NULL,
        stddev real NOT NULL,
        sample_days int NOT NULL,
        data_completeness real NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (id, computed_on)
      ) PARTITION BY RANGE (computed_on)`);
    await q.query(`CREATE UNIQUE INDEX baseline_snapshot_unique_idx
      ON baseline_snapshot (elder_id, computed_on, dimension)`);
    await q.query(`COMMENT ON TABLE baseline_snapshot IS
      '每日一筆快照，永久保留供事後追溯。pattern_alert 引用其 id，不得刪除或覆寫（交接規格 §2.3）'`);

    await q.query(`
      CREATE TABLE pattern_alert (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL REFERENCES elder(id) ON DELETE CASCADE,
        level varchar(2) NOT NULL,
        dimensions jsonb NOT NULL,
        headline text NOT NULL,
        explanation text NOT NULL,
        baseline_snapshot_id uuid,
        rule_version varchar(32) NOT NULL,
        model_version varchar(32) NOT NULL,
        prompt_version varchar(32) NOT NULL,
        internal_only boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pattern_alert_level_chk CHECK (level IN ('P0','P1','P2','P3'))
      )`);
    await q.query(`CREATE INDEX pattern_alert_idx ON pattern_alert (elder_id, created_at DESC, level)`);
    await q.query(`COMMENT ON TABLE pattern_alert IS
      'rule/model/prompt version 為 NOT NULL：每則通知須可回溯（交接規格 §6）'`);

    await q.query(`
      CREATE TABLE alert_signal_link (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        alert_id uuid NOT NULL REFERENCES pattern_alert(id) ON DELETE CASCADE,
        signal_id uuid NOT NULL,
        weight real NOT NULL DEFAULT 1
      )`);
    await q.query(`CREATE INDEX alert_signal_link_idx ON alert_signal_link (alert_id)`);

    await q.query(`
      CREATE TABLE alert_ack (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        alert_id uuid NOT NULL REFERENCES pattern_alert(id) ON DELETE CASCADE,
        guardian_id uuid NOT NULL REFERENCES guardian(id) ON DELETE CASCADE,
        action varchar(24) NOT NULL,
        feedback varchar(24),
        acked_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT alert_ack_action_chk CHECK (action IN ('contacted','inaccurate','mute_this_type')),
        CONSTRAINT alert_ack_feedback_chk CHECK (feedback IS NULL OR feedback IN
          ('helpful','inaccurate','mute_this_type'))
      )`);
    await q.query(`CREATE INDEX alert_ack_idx ON alert_ack (alert_id)`);

    await q.query(`
      CREATE TABLE weekly_digest (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL REFERENCES elder(id) ON DELETE CASCADE,
        week_start date NOT NULL,
        headline text NOT NULL,
        body text NOT NULL,
        dimension_summary jsonb NOT NULL,
        sent_at timestamptz,
        usefulness_feedback varchar(24),
        UNIQUE (elder_id, week_start)
      )`);
    await q.query(`COMMENT ON TABLE weekly_digest IS '內容不含聊天原文（交接規格 §2.3）'`);

    // ── §2.4 醫療、公部門資料與通知 ──────────────────────────
    await q.query(`
      CREATE TABLE medical_journey (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL REFERENCES elder(id) ON DELETE CASCADE,
        visit_at timestamptz NOT NULL,
        hospital varchar(64) NOT NULL,
        department varchar(32),
        doctor varchar(32),
        source varchar(16) NOT NULL,
        elder_confirmed boolean NOT NULL DEFAULT false,
        status varchar(16) NOT NULL DEFAULT 'pending',
        completed_note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT journey_source_chk CHECK (source IN ('chat_extract','ocr','gov_api','manual')),
        CONSTRAINT journey_status_chk CHECK (status IN ('pending','confirmed','rescheduling','done'))
      )`);
    await q.query(`CREATE INDEX medical_journey_idx ON medical_journey (elder_id, visit_at)`);

    await q.query(`
      CREATE TABLE medication_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL REFERENCES elder(id) ON DELETE CASCADE,
        journey_id uuid REFERENCES medical_journey(id) ON DELETE SET NULL,
        ocr_raw text NOT NULL,
        drug_name varchar(128),
        dosage varchar(128),
        human_verified_by uuid,
        verified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT medication_verify_chk CHECK (
          (human_verified_by IS NULL AND verified_at IS NULL) OR
          (human_verified_by IS NOT NULL AND verified_at IS NOT NULL))
      )`);
    await q.query(`CREATE INDEX medication_item_idx ON medication_item (elder_id, human_verified_by)`);
    await q.query(`COMMENT ON TABLE medication_item IS
      'human_verified_by 為空時不可建立用藥提醒（交接規格 §2.4、§6）'`);

    await q.query(`
      CREATE TABLE gov_health_record (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL REFERENCES elder(id) ON DELETE CASCADE,
        source_system varchar(32) NOT NULL,
        exam_date date NOT NULL,
        payload_encrypted text NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        data_as_of date NOT NULL
      )`);
    await q.query(`CREATE INDEX gov_health_record_idx ON gov_health_record (elder_id, exam_date DESC)`);
    await q.query(`COMMENT ON COLUMN gov_health_record.payload_encrypted IS
      '欄位級加密。只存解析後必要欄位，原始 JSON 不落地（交接規格 §5、§7）'`);

    await q.query(`
      CREATE TABLE checkup_eligibility (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        elder_id uuid NOT NULL REFERENCES elder(id) ON DELETE CASCADE,
        program varchar(64) NOT NULL,
        year int NOT NULL,
        available boolean NOT NULL,
        last_used_date date,
        checked_at timestamptz NOT NULL DEFAULT now(),
        degraded boolean NOT NULL DEFAULT false,
        UNIQUE (elder_id, program, year)
      )`);

    await q.query(`
      CREATE TABLE community_activity (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        station_name varchar(128) NOT NULL,
        title varchar(128) NOT NULL,
        start_at timestamptz NOT NULL,
        geo jsonb NOT NULL,
        region_code varchar(16) NOT NULL,
        source_dataset varchar(64) NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX community_activity_idx ON community_activity (region_code, start_at)`);
    await q.query(`COMMENT ON TABLE community_activity IS
      '公開資料無個資。快取超過 14 天不得顯示（交接規格 §2.4）'`);

    await q.query(`
      CREATE TABLE notification (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_type varchar(8) NOT NULL,
        recipient_id uuid NOT NULL,
        kind varchar(32) NOT NULL,
        payload jsonb NOT NULL,
        alert_id uuid REFERENCES pattern_alert(id) ON DELETE SET NULL,
        sent_at timestamptz,
        suppressed_reason varchar(64),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT notification_recipient_chk CHECK (recipient_type IN ('elder','guardian')),
        -- 送出與抑制互斥：兩者同時為真代表邏輯錯誤，直接擋在 DB
        CONSTRAINT notification_state_chk CHECK (NOT (sent_at IS NOT NULL AND suppressed_reason IS NOT NULL))
      )`);
    await q.query(`CREATE INDEX notification_idx
      ON notification (recipient_type, recipient_id, sent_at DESC)`);
    await q.query(`COMMENT ON TABLE notification IS
      '被抑制者仍寫入並記 suppressed_reason（交接規格 §2.4）'`);

    await q.query(`
      CREATE TABLE audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_type varchar(8) NOT NULL,
        actor_id uuid,
        action varchar(64) NOT NULL,
        target_table varchar(64) NOT NULL,
        target_id varchar(64),
        before jsonb,
        after jsonb,
        at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT audit_actor_chk CHECK (actor_type IN ('elder','guardian','admin','system'))
      )`);
    await q.query(`CREATE INDEX audit_log_idx ON audit_log (target_table, target_id, at DESC)`);
    await q.query(`CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, at DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'audit_log',
      'notification',
      'community_activity',
      'checkup_eligibility',
      'gov_health_record',
      'medication_item',
      'medical_journey',
      'weekly_digest',
      'alert_ack',
      'alert_signal_link',
      'pattern_alert',
      'baseline_snapshot',
      'memory_item',
      'signal_review',
      'life_signal',
      'message',
      'persona_config_history',
      'persona_config',
      'consent',
      'link_invite',
      'guardian_link',
      'guardian',
      'elder',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
  }
}
