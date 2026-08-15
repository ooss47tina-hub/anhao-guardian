import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Elder } from 'src/database/entities';
import { LINE_PORT, LineInboundEvent, LinePort } from 'src/ports/line.port';
import { OBJECT_STORAGE_PORT, ObjectStoragePort } from 'src/ports/object-storage.port';
import { STT_PORT, SttPort } from 'src/ports/stt.port';
import { ConversationService } from 'src/modules/conversation/conversation.service';
import { MessageRepository } from 'src/modules/conversation/message.repository';
import { MedicationService } from 'src/modules/medical/medication.service';

/**
 * 佇列消費端。
 *
 * 交接規格 §1 Ingest：「LINE Webhook 收文字／語音／圖片，語音走 STT，
 * 圖片走 Vision OCR。」
 */
@Injectable()
export class IngestProcessor {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(
    @InjectRepository(Elder) private readonly elders: Repository<Elder>,
    private readonly conversation: ConversationService,
    private readonly messages: MessageRepository,
    private readonly medication: MedicationService,
    private readonly config: ConfigService,
    @Inject(STT_PORT) private readonly stt: SttPort,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    @Inject(LINE_PORT) private readonly line: LinePort,
  ) {}

  async process(event: LineInboundEvent): Promise<void> {
    const elder = await this.elders.findOne({ where: { lineUserId: event.lineUserId } });
    if (!elder) {
      this.logger.warn(`收到未綁定 LINE 使用者的訊息：${event.lineUserId}`);
      return;
    }

    switch (event.modality) {
      case 'text':
        await this.handleText(elder.id, event);
        return;
      case 'audio':
        await this.handleAudio(elder.id, event);
        return;
      case 'image':
        await this.handleImage(elder.id, event);
        return;
    }
  }

  private async handleText(elderId: string, event: LineInboundEvent): Promise<void> {
    if (!event.text) return;
    const result = await this.conversation.handleTurn({ elderId, utterance: event.text });
    await this.line.push({ lineUserId: event.lineUserId, text: result.reply });
  }

  /**
   * 語音走 STT。
   *
   * 交接規格 §3：「回傳文字與信心值；低於 0.75 要求長者重說，不猜語意。」
   * 低信心時不進 LLM、不萃取訊號 —— 猜錯的語意會污染 Baseline。
   */
  private async handleAudio(elderId: string, event: LineInboundEvent): Promise<void> {
    if (!event.contentId) return;

    const content = await this.line.fetchContent(event.contentId);
    const ref = await this.storage.put({
      key: `elder/${elderId}/audio/${event.contentId}`,
      data: content.data,
      mimeType: content.mimeType,
      retentionDays: this.config.get<number>('rules.voiceRetentionDays'),
    });

    const transcript = await this.stt.transcribe({ ref, mimeType: content.mimeType });
    const minConfidence = this.config.get<number>('rules.sttMinConfidence') ?? 0.75;

    if (transcript.confidence < minConfidence) {
      // 只留訊息紀錄與信心值，不產生訊號。
      await this.messages.append({
        elderId,
        direction: 'inbound',
        modality: 'audio',
        text: null,
        sttConfidence: transcript.confidence,
        audioRef: ref,
      });
      await this.line.push({
        lineUserId: event.lineUserId,
        text: '我剛剛沒聽清楚，可以再說一次嗎？',
      });
      return;
    }

    await this.messages.append({
      elderId,
      direction: 'inbound',
      modality: 'audio',
      text: transcript.text,
      sttConfidence: transcript.confidence,
      audioRef: ref,
    });

    const result = await this.conversation.handleTurn({ elderId, utterance: transcript.text });
    await this.line.push({ lineUserId: event.lineUserId, text: result.reply });
  }

  /**
   * 圖片走 Vision OCR。
   * 辨識結果一律「請確認」後才能成為高影響資料（SRS F1-04）。
   */
  private async handleImage(elderId: string, event: LineInboundEvent): Promise<void> {
    if (!event.contentId) return;

    const content = await this.line.fetchContent(event.contentId);
    const ref = await this.storage.put({
      key: `elder/${elderId}/image/${event.contentId}`,
      data: content.data,
      mimeType: content.mimeType,
    });

    await this.messages.append({
      elderId,
      direction: 'inbound',
      modality: 'image',
      imageRef: ref,
    });

    const { items, nextVisitAt } = await this.medication.ingestFromPhoto({
      elderId,
      journeyId: null,
      imageRef: ref,
      mimeType: content.mimeType,
    });

    const lines = ['我看到上面有幾件事，你幫我確認一下對不對？'];
    if (nextVisitAt) lines.push(`下次回診：${nextVisitAt.slice(0, 10)}`);
    lines.push(`藥名與吃法共 ${items.length} 項 — 這部分我不會自己判斷，會請專人看過再幫你設提醒。`);

    await this.line.push({ lineUserId: event.lineUserId, text: lines.join('\n') });
  }
}
