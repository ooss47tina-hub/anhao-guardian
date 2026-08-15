import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LineInboundEvent } from 'src/ports/line.port';
import { IngestProcessor } from './ingest.processor';

export const INGEST_QUEUE_NAME = 'ingest';

/**
 * Webhook 入佇列。
 *
 * 交接規格 §7：「訊息佇列用 SQS 或 Redis Streams，讓 Webhook 3 秒內回應。」
 *
 * 目前為記憶體內佇列 —— 單機可跑、測試可斷言，但重啟會掉訊息。
 * TODO(infra)：正式環境改 BullMQ + Redis。介面已對齊 BullMQ 的 add/process 模型，
 * 換掉這個類別的內部實作即可，呼叫端不需改。多副本部署前必須先換掉。
 */
@Injectable()
export class IngestQueue implements OnModuleDestroy {
  private readonly logger = new Logger(IngestQueue.name);
  private readonly pending: LineInboundEvent[] = [];
  private draining = false;

  constructor(
    private readonly processor: IngestProcessor,
    private readonly config: ConfigService,
  ) {}

  async enqueue(event: LineInboundEvent): Promise<void> {
    this.pending.push(event);
    // 不 await —— webhook 必須在 3 秒內回 200。
    void this.drain();
  }

  /** 測試用：等佇列清空。 */
  async flush(): Promise<void> {
    while (this.pending.length > 0 || this.draining) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  get depth(): number {
    return this.pending.length;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const event = this.pending.shift() as LineInboundEvent;
        try {
          await this.processor.process(event);
        } catch (error) {
          // 單一事件失敗不得拖垮整個佇列。正式環境改 BullMQ 後由重試機制接手
          // （SRS 3.3 可用性：通知工作佇列具重試機制）。
          this.logger.error(
            `處理 LINE 事件失敗 user=${event.lineUserId}: ${(error as Error).message}`,
          );
        }
      }
    } finally {
      this.draining = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }
}
