import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 交接規格 §2.1 身分與關係。
 * 檔案切分刻意對齊規格章節，方便逐節比對驗收。
 */

export type ElderStatus = 'onboarding' | 'active' | 'paused' | 'erased';

@Entity('elder')
export class Elder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'line_user_id', type: 'varchar', length: 64 })
  lineUserId: string;

  @Column({ name: 'display_name', type: 'varchar', length: 64 })
  displayName: string;

  /**
   * 只存出生年，不存完整生日。
   * 交接規格 §2.1：「不存完整身分證號；健保卡認證只留 token 與到期日」。
   *
   * 未經 E-00 精靈確認前為 null。不得以假值填充 ——
   * 假的出生年會被當成真的拿去判斷健檢資格等年齡相關規則。
   */
  @Column({ name: 'birth_year', type: 'int', nullable: true })
  birthYear: number | null;

  @Column({ name: 'living_alone', type: 'boolean', default: false })
  livingAlone: boolean;

  @Column({ type: 'varchar', length: 16, default: 'zh-TW' })
  locale: string;

  /** 縣市代碼，用於社區活動查詢。不存詳細住址。 */
  @Column({ name: 'region_code', type: 'varchar', length: 16, nullable: true })
  regionCode: string | null;

  @Column({ type: 'varchar', length: 16, default: 'onboarding' })
  status: ElderStatus;

  /** 健保卡認證 token 與到期日。不存卡號、不存身分證號。 */
  @Column({ name: 'health_card_token', type: 'text', nullable: true })
  healthCardToken: string | null;

  @Column({ name: 'health_card_token_expires_at', type: 'timestamptz', nullable: true })
  healthCardTokenExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

export type NotifyChannel = 'line' | 'web_push';

@Entity('guardian')
export class Guardian {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'line_user_id', type: 'varchar', length: 64 })
  lineUserId: string;

  @Column({ name: 'display_name', type: 'varchar', length: 64 })
  displayName: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone: string | null;

  @Column({ name: 'notify_channel', type: 'varchar', length: 16, default: 'line' })
  notifyChannel: NotifyChannel;

  /** 安靜時段。高風險（P3）不受此限制（交接規格 §4 safety_rule）。 */
  @Column({ name: 'quiet_hours_start', type: 'varchar', length: 5, nullable: true })
  quietHoursStart: string | null;

  @Column({ name: 'quiet_hours_end', type: 'varchar', length: 5, nullable: true })
  quietHoursEnd: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/**
 * 一位守護者可對應多位長者；每位長者僅一位 is_primary。
 * 解除以 revoked_at 標記，不硬刪（交接規格 §2.1）。
 */
@Entity('guardian_link')
@Index(['elderId', 'guardianId'], { unique: true })
export class GuardianLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @ManyToOne(() => Elder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'elder_id' })
  elder: Elder;

  @Column({ name: 'guardian_id', type: 'uuid' })
  guardianId: string;

  @ManyToOne(() => Guardian, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'guardian_id' })
  guardian: Guardian;

  @Column({ type: 'varchar', length: 32 })
  relation: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @Column({ name: 'invited_by', type: 'uuid', nullable: true })
  invitedBy: string | null;

  @Column({ name: 'bound_at', type: 'timestamptz' })
  boundAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}

/**
 * 綁定邀請碼。一次性、24 小時失效（交接規格 §3 /v1/links/invite）。
 * 規格第 2 節未列此表，但 M1 綁定流程必要，於此補上並在 HANDOFF.md 標註。
 */
@Entity('link_invite')
export class LinkInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 16 })
  code: string;

  @Column({ name: 'elder_id', type: 'uuid', nullable: true })
  elderId: string | null;

  @Column({ name: 'guardian_id', type: 'uuid', nullable: true })
  guardianId: string | null;

  @Column({ name: 'created_by_role', type: 'varchar', length: 16 })
  createdByRole: 'elder' | 'guardian';

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** 一次性：使用後寫入時間，再次使用即拒絕。 */
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/** 用途分層同意。交接規格 §2.1 consent.scope。 */
export const CONSENT_SCOPES = [
  'core',
  'medical',
  'pattern_share',
  'voice_retention',
  'mood_share',
  'raw_chat_share',
] as const;

export type ConsentScope = (typeof CONSENT_SCOPES)[number];

/** 必要項目不開就沒辦法用（介面原型 M1）。 */
export const REQUIRED_CONSENT_SCOPES: ConsentScope[] = ['core'];

/**
 * append-only。DB trigger 擋 UPDATE/DELETE，見 migration AppendOnlyGuards。
 * 撤銷授權的做法是插入一筆 granted=false 的新紀錄，不是改舊紀錄。
 */
@Entity('consent')
@Index(['elderId', 'scope', 'grantedAt'])
export class Consent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ type: 'varchar', length: 32 })
  scope: ConsentScope;

  @Column({ type: 'boolean' })
  granted: boolean;

  @Column({ name: 'consent_version', type: 'varchar', length: 32 })
  consentVersion: string;

  @Column({ name: 'granted_at', type: 'timestamptz' })
  grantedAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /** 同意證據參照（LINE 訊息 id 或 LIFF 事件 id）。 */
  @Column({ name: 'evidence_ref', type: 'varchar', length: 128 })
  evidenceRef: string;
}

export type PersonaTemplate = 'life_assistant' | 'companion' | 'concise' | 'family_bridge';

@Entity('persona_config')
export class PersonaConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ name: 'template_key', type: 'varchar', length: 32 })
  templateKey: PersonaTemplate;

  @Column({ name: 'persona_name', type: 'varchar', length: 32 })
  personaName: string;

  @Column({ name: 'elder_salutation', type: 'varchar', length: 32 })
  elderSalutation: string;

  @Column({ name: 'voice_id', type: 'varchar', length: 32, nullable: true })
  voiceId: string | null;

  @Column({ name: 'avatar_key', type: 'varchar', length: 32, nullable: true })
  avatarKey: string | null;

  @Column({ name: 'initiative_level', type: 'varchar', length: 8, default: 'medium' })
  initiativeLevel: 'low' | 'medium' | 'high';

  @Column({ name: 'reminder_style', type: 'varchar', length: 8, default: 'gentle' })
  reminderStyle: 'gentle' | 'direct';

  @Column({ name: 'speaking_speed', type: 'varchar', length: 8, default: 'slow' })
  speakingSpeed: 'slow' | 'normal';

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * 保留變更歷史以解釋語氣變化（交接規格 §2.1）。
 * SRS F0-03：所有自動調整需留下設定變更紀錄，長者可還原。
 */
@Entity('persona_config_history')
@Index(['elderId', 'changedAt'])
export class PersonaConfigHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ type: 'varchar', length: 32 })
  field: string;

  @Column({ name: 'old_value', type: 'text', nullable: true })
  oldValue: string | null;

  @Column({ name: 'new_value', type: 'text', nullable: true })
  newValue: string | null;

  /** manual：長者或家人設定；adaptive：AI 依「講慢一點」等回饋自動調整。 */
  @Column({ type: 'varchar', length: 16 })
  source: 'manual' | 'adaptive';

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @CreateDateColumn({ name: 'changed_at', type: 'timestamptz' })
  changedAt: Date;
}
