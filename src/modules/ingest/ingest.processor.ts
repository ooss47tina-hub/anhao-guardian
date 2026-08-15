import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Elder, PersonaConfig } from 'src/database/entities';
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
    @InjectRepository(PersonaConfig) private readonly personas: Repository<PersonaConfig>,
    private readonly conversation: ConversationService,
    private readonly messages: MessageRepository,
    private readonly medication: MedicationService,
    private readonly config: ConfigService,
    @Inject(STT_PORT) private readonly stt: SttPort,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    @Inject(LINE_PORT) private readonly line: LinePort,
  ) {}

  async process(event: LineInboundEvent): Promise<void> {
    let elder = await this.elders.findOne({ where: { lineUserId: event.lineUserId } });

    if (event.modality === 'follow') {
      await this.handleFollow(event, elder);
      return;
    }

    if (!elder) {
      /**
       * 未綁定的使用者。
       *
       * 正式流程是走 M1 邀請碼綁定（交接規格 §3）；在試用階段可用
       * LINE_AUTO_REGISTER_ELDER=true 自動建立長者資料，省去每次手動 seed。
       * 這個開關預設關閉 —— 正式環境自動建帳號等於任何人都能開通服務。
       */
      if (!this.autoRegisterEnabled) {
        this.logger.warn(`收到未綁定 LINE 使用者的訊息：${event.lineUserId}`);
        await this.line.push({
          lineUserId: event.lineUserId,
          text: '你好，我是小安。我們還沒連起來 —— 請家人給你一組邀請碼，或請他們幫你設定。',
        });
        return;
      }
      elder = await this.autoRegister(event.lineUserId);
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

  private get autoRegisterEnabled(): boolean {
    return this.config.get<boolean>('line.autoRegisterElder') === true;
  }

  /** 加好友。已綁定者打招呼；未綁定者引導綁定。 */
  private async handleFollow(event: LineInboundEvent, elder: Elder | null): Promise<void> {
    if (elder) {
      await this.line.push({
        lineUserId: event.lineUserId,
        text: '我又回來了，隨時可以跟我說話。',
      });
      return;
    }

    if (this.autoRegisterEnabled) {
      const created = await this.autoRegister(event.lineUserId);
      this.logger.log(`自動建立長者 ${created.id}（${created.displayName}）`);
      const greeting = created.displayName === '（未命名）' ? '你好' : `${created.displayName}你好`;
      await this.line.push({
        lineUserId: event.lineUserId,
        text: `${greeting}，我是小安，是一個 AI 生活夥伴、不是真人。\n想跟我說什麼都可以，今天過得怎麼樣？`,
      });
      return;
    }

    await this.line.push({
      lineUserId: event.lineUserId,
      text: '你好，我是小安。請家人給你一組邀請碼，我們就能連起來了。',
    });
  }

  /**
   * 試用階段的自動建檔。
   *
   * 只建最小資料：core 同意由長者之後在 LINE 確認，這裡不代為授予 ——
   * 授權一律由長者本人確認是產品原則（交接規格 §6），自動建檔不能是它的例外。
   *
   * 稱呼取自 LINE 顯示名稱。這只是初始預設值 —— 正式流程應由 E-00 精靈
   * 詢問「它要怎麼叫你」（SRS F0-01），長者也可隨時說「叫我阿姨就好」改掉。
   */
  private async autoRegister(lineUserId: string): Promise<Elder> {
    const profile = await this.line.getProfile(lineUserId).catch(() => ({
      lineUserId,
      displayName: '',
    }));
    const name = profile.displayName.trim();

    const elder = await this.elders.save(
      this.elders.create({
        lineUserId,
        displayName: name || '（未命名）',
        // 生日未知，留 null。E-00 精靈問過才會有值 ——
        // 填假年份會被當成真的拿去判斷健檢資格等年齡相關規則。
        birthYear: null,
        livingAlone: false,
        locale: 'zh-TW',
        status: 'active',
      }),
    );

    // 一併建立 persona，讓第一句回話就有正確稱呼。
    await this.personas.save(
      this.personas.create({
        elderId: elder.id,
        templateKey: 'companion',
        personaName: '小安',
        elderSalutation: name || '您',
        initiativeLevel: 'medium',
        reminderStyle: 'gentle',
      }),
    );

    return elder;
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
