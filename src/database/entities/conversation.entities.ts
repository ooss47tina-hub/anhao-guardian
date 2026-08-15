import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SignalDimension } from 'src/domain/signal-dimension';

/** 交接規格 §2.2 對話與訊號。 */

export type MessageDirection = 'inbound' | 'outbound';
export type MessageModality = 'text' | 'audio' | 'image';

@Entity('message')
@Index(['elderId', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ type: 'varchar', length: 8 })
  direction: MessageDirection;

  @Column({ type: 'varchar', length: 8 })
  modality: MessageModality;

  /**
   * 密文欄位。交接規格 §2.2：「text 欄位加密靜態儲存」。
   * 一律經 MessageRepository 進出，呼叫端不得直接讀這個欄位。
   * 守護者端永遠拿不到這個欄位的內容，除非長者開啟 raw_chat_share（§6）。
   */
  @Column({ name: 'text_encrypted', type: 'text', nullable: true })
  textEncrypted: string | null;

  @Column({ name: 'stt_confidence', type: 'real', nullable: true })
  sttConfidence: number | null;

  /** 僅在 voice_retention 授權時保留（交接規格 §2.2）。 */
  @Column({ name: 'audio_ref', type: 'varchar', length: 256, nullable: true })
  audioRef: string | null;

  @Column({ name: 'image_ref', type: 'varchar', length: 256, nullable: true })
  imageRef: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

export type ReviewState = 'auto_accepted' | 'pending_review' | 'reviewed';

@Entity('life_signal')
@Index(['elderId', 'occurredOn', 'dimension'])
@Index(['reviewState', 'confidence'])
export class LifeSignal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId: string | null;

  @Column({ type: 'varchar', length: 24 })
  dimension: SignalDimension;

  @Column({ type: 'varchar', length: 64 })
  value: string;

  @Column({ type: 'real' })
  confidence: number;

  /** 供 Pattern 可解釋性與人工抽查回溯（交接規格 §6）。 */
  @Column({ name: 'extractor_version', type: 'varchar', length: 32 })
  extractorVersion: string;

  /** 訊號發生日（不是寫入日）。Baseline 以此聚合。 */
  @Column({ name: 'occurred_on', type: 'date' })
  occurredOn: string;

  @Column({ name: 'review_state', type: 'varchar', length: 16, default: 'auto_accepted' })
  reviewState: ReviewState;

  /** 原句中的依據片段，供 Console 抽查對照。 */
  @Column({ type: 'text', nullable: true })
  evidence: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

export type ReviewVerdict = 'correct' | 'corrected' | 'discarded';

/** 回饋 extractor 訓練集（交接規格 §2.2）。 */
@Entity('signal_review')
export class SignalReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'signal_id', type: 'uuid' })
  signalId: string;

  @Column({ name: 'reviewer_id', type: 'uuid' })
  reviewerId: string;

  @Column({ type: 'varchar', length: 16 })
  verdict: ReviewVerdict;

  @Column({ name: 'corrected_value', type: 'varchar', length: 64, nullable: true })
  correctedValue: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz' })
  reviewedAt: Date;
}

export type MemoryKind = 'preference' | 'relation' | 'routine' | 'place' | 'medical' | 'event';

@Entity('memory_item')
@Index(['elderId', 'kind'])
export class MemoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'elder_id', type: 'uuid' })
  elderId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: MemoryKind;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'source_message_id', type: 'uuid', nullable: true })
  sourceMessageId: string | null;

  /**
   * 交接規格 §2.2：「未經長者確認（confirmed_by_elder = false）不得用於主動提醒」。
   * 由 MemoryService.forProactiveUse() 強制過濾。
   */
  @Column({ name: 'confirmed_by_elder', type: 'boolean', default: false })
  confirmedByElder: boolean;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'real', default: 0 })
  confidence: number;

  @Column({ name: 'valid_from', type: 'timestamptz', nullable: true })
  validFrom: Date | null;

  @Column({ name: 'valid_to', type: 'timestamptz', nullable: true })
  validTo: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
