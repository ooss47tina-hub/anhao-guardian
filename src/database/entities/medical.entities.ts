import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** 交接規格 §2.4 醫療、公部門資料與通知。 */

export type JourneySource = 'chat_extract' | 'ocr' | 'gov_api' | 'manual';
export type JourneyStatus = 'pending' | 'confirmed' | 'rescheduling' | 'done';

@Entity('medical_journey')
@Index(['elderId', 'visitAt'])
export class MedicalJourney {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ name: 'visit_at', type: 'timestamptz' })
  visitAt: Date;

  @Column({ type: 'varchar', length: 64 })
  hospital: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  doctor: string | null;

  @Column({ type: 'varchar', length: 16 })
  source: JourneySource;

  /** 高影響資料需長者確認（SRS F1-02）。未確認不得推播給守護者。 */
  @Column({ name: 'elder_confirmed', type: 'boolean', default: false })
  elderConfirmed: boolean;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: JourneyStatus;

  /** 長者一句話的完成回覆。不做 GPS 全程追蹤（交接規格 §6）。 */
  @Column({ name: 'completed_note', type: 'text', nullable: true })
  completedNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/**
 * 藥品項目。
 *
 * 交接規格 §2.4：「human_verified_by 為空時不可建立用藥提醒」。
 * 這條由 MedicationService 在建立提醒前強制檢查，見 HumanReviewRequiredError。
 */
@Entity('medication_item')
@Index(['elderId', 'humanVerifiedBy'])
export class MedicationItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ name: 'journey_id', type: 'uuid', nullable: true })
  journeyId: string | null;

  /** OCR 原始辨識文字。保留原樣供人工核對。 */
  @Column({ name: 'ocr_raw', type: 'text' })
  ocrRaw: string;

  @Column({ name: 'drug_name', type: 'varchar', length: 128, nullable: true })
  drugName: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  dosage: string | null;

  /** 人工確認者。為 null 代表尚未確認。 */
  @Column({ name: 'human_verified_by', type: 'uuid', nullable: true })
  humanVerifiedBy: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/**
 * 健檢數值原樣保存。
 * 交接規格 §5：原始 JSON 不落地 —— payload 只存解析後的必要欄位，且加密儲存。
 */
@Entity('gov_health_record')
@Index(['elderId', 'examDate'])
export class GovHealthRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ name: 'source_system', type: 'varchar', length: 32 })
  sourceSystem: string;

  @Column({ name: 'exam_date', type: 'date' })
  examDate: string;

  /** 密文。經 CryptoPort 進出（交接規格 §7）。 */
  @Column({ name: 'payload_encrypted', type: 'text' })
  payloadEncrypted: string;

  @Column({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt: Date;

  /** 前端據此標註「資料未即時更新」（交接規格 §2.4）。 */
  @Column({ name: 'data_as_of', type: 'date' })
  dataAsOf: string;
}

@Entity('checkup_eligibility')
@Index(['elderId', 'program', 'year'], { unique: true })
export class CheckupEligibility {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ type: 'varchar', length: 64 })
  program: string;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'boolean' })
  available: boolean;

  @Column({ name: 'last_used_date', type: 'date', nullable: true })
  lastUsedDate: string | null;

  @Column({ name: 'checked_at', type: 'timestamptz' })
  checkedAt: Date;

  /** true 表示由「上次日期 + 1 年」推算而非 API 實查（交接規格 §2.4）。 */
  @Column({ type: 'boolean', default: false })
  degraded: boolean;
}

/** 公開資料無個資。快取超過 14 天不得顯示（交接規格 §2.4）。 */
@Entity('community_activity')
@Index(['regionCode', 'startAt'])
export class CommunityActivityRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'station_name', type: 'varchar', length: 128 })
  stationName: string;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt: Date;

  @Column({ type: 'jsonb' })
  geo: { lat: number; lng: number };

  @Column({ name: 'region_code', type: 'varchar', length: 16 })
  regionCode: string;

  @Column({ name: 'source_dataset', type: 'varchar', length: 64 })
  sourceDataset: string;

  @Column({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt: Date;
}

export type RecipientType = 'elder' | 'guardian';
export type NotificationKind =
  | 'pattern_alert'
  | 'weekly_digest'
  | 'medical_reminder'
  | 'checkup_reminder'
  | 'safety_alert'
  | 'consent_request';

/**
 * 被安靜時段或偏好抑制者仍寫入，記 suppressed_reason（交接規格 §2.4）。
 * 這是刻意設計 —— 「沒通知」也要留下紀錄，否則事後無法解釋為什麼家人沒收到。
 */
@Entity('notification')
@Index(['recipientType', 'recipientId', 'sentAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'recipient_type', type: 'varchar', length: 8 })
  recipientType: RecipientType;

  @Column({ name: 'recipient_id', type: 'uuid' })
  recipientId: string;

  @Column({ type: 'varchar', length: 32 })
  kind: NotificationKind;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'alert_id', type: 'uuid', nullable: true })
  alertId: string | null;

  /** null 代表未實際送出（被抑制或尚未送）。 */
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'suppressed_reason', type: 'varchar', length: 64, nullable: true })
  suppressedReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

export type AuditActorType = 'elder' | 'guardian' | 'admin' | 'system';

/**
 * append-only。DB trigger 擋 UPDATE/DELETE。
 * 交接規格 §2.4：「授權變更、人工修正、資料匯出與刪除皆需記錄」。
 */
@Entity('audit_log')
@Index(['targetTable', 'targetId', 'at'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_type', type: 'varchar', length: 8 })
  actorType: AuditActorType;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ name: 'target_table', type: 'varchar', length: 64 })
  targetTable: string;

  @Column({ name: 'target_id', type: 'varchar', length: 64, nullable: true })
  targetId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'at', type: 'timestamptz' })
  at: Date;
}
