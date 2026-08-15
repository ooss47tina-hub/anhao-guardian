import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AlertLevel, SignalDimension } from 'src/domain/signal-dimension';

/** 交接規格 §2.3 Baseline 與 Pattern。 */

/**
 * 每日一筆快照，永久保留供事後追溯（交接規格 §2.3）。
 * pattern_alert 引用快照 id，所以快照不得刪除、不得覆寫 —— 否則舊通知無法重建。
 */
@Entity('baseline_snapshot')
@Index(['elderId', 'computedOn', 'dimension'], { unique: true })
export class BaselineSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ name: 'computed_on', type: 'date' })
  computedOn: string;

  @Column({ name: 'window_days', type: 'int' })
  windowDays: number;

  @Column({ type: 'varchar', length: 24 })
  dimension: SignalDimension;

  @Column({ type: 'real' })
  mean: number;

  @Column({ type: 'real' })
  stddev: number;

  /** 視窗內有訊號的天數。 */
  @Column({ name: 'sample_days', type: 'int' })
  sampleDays: number;

  /** sample_days / window_days。低於門檻時前端只顯示「資料仍在建立」。 */
  @Column({ name: 'data_completeness', type: 'real' })
  dataCompleteness: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('pattern_alert')
@Index(['elderId', 'createdAt', 'level'])
export class PatternAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ type: 'varchar', length: 2 })
  level: AlertLevel;

  @Column({ type: 'jsonb' })
  dimensions: SignalDimension[];

  @Column({ type: 'text' })
  headline: string;

  /**
   * 給人看的文字，需可由 supporting_signals 重建（交接規格 §2.3）。
   * 寫入前必經 DiagnosticLanguageFilter —— 不得含診斷式語言（§6）。
   */
  @Column({ type: 'text' })
  explanation: string;

  @Column({ name: 'baseline_snapshot_id', type: 'uuid', nullable: true })
  baselineSnapshotId: string | null;

  /** 以下三個版本欄位為 NOT NULL：交接規格 §6 要求每則通知可回溯。 */
  @Column({ name: 'rule_version', type: 'varchar', length: 32 })
  ruleVersion: string;

  @Column({ name: 'model_version', type: 'varchar', length: 32 })
  modelVersion: string;

  @Column({ name: 'prompt_version', type: 'varchar', length: 32 })
  promptVersion: string;

  /**
   * P0／P1 與資料不足時的內部記錄不推播。
   * 交接規格 §4：「有效生活日 < 21 天者只寫內部記錄，不通知家人」。
   */
  @Column({ name: 'internal_only', type: 'boolean', default: false })
  internalOnly: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/** 支撐「為什麼這樣判斷」的證據清單（交接規格 §2.3）。 */
@Entity('alert_signal_link')
export class AlertSignalLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'alert_id', type: 'uuid' })
  alertId: string;

  @Column({ name: 'signal_id', type: 'uuid' })
  signalId: string;

  @Column({ type: 'real', default: 1 })
  weight: number;
}

export type AckAction = 'contacted' | 'inaccurate' | 'mute_this_type';
export type AckFeedback = 'helpful' | 'inaccurate' | 'mute_this_type';

/** feedback 回饋門檻調整（交接規格 §2.3）。 */
@Entity('alert_ack')
export class AlertAck {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'alert_id', type: 'uuid' })
  alertId: string;

  @Column({ name: 'guardian_id', type: 'uuid' })
  guardianId: string;

  @Column({ type: 'varchar', length: 24 })
  action: AckAction;

  @Column({ type: 'varchar', length: 24, nullable: true })
  feedback: AckFeedback | null;

  @Column({ name: 'acked_at', type: 'timestamptz' })
  ackedAt: Date;
}

/** 週一 09:00 產生，內容不含聊天原文（交接規格 §2.3）。 */
@Entity('weekly_digest')
@Index(['elderId', 'weekStart'], { unique: true })
export class WeeklyDigest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ name: 'week_start', type: 'date' })
  weekStart: string;

  @Column({ type: 'text' })
  headline: string;

  @Column({ type: 'text' })
  body: string;

  /** 四維度與 Baseline 對照。不含任何原句。 */
  @Column({ name: 'dimension_summary', type: 'jsonb' })
  dimensionSummary: Array<{ dimension: SignalDimension; recent: number; baseline: number }>;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  /** 有幫助／不太準／這種不用提醒（介面原型 G-02）。 */
  @Column({ name: 'usefulness_feedback', type: 'varchar', length: 24, nullable: true })
  usefulnessFeedback: string | null;
}
