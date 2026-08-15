import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsentService } from 'src/common/consent/consent.service';
import { Message, MessageDirection, MessageModality } from 'src/database/entities';
import { CRYPTO_PORT, CryptoPort } from 'src/ports/crypto.port';

export interface DecryptedMessage {
  id: string;
  direction: MessageDirection;
  modality: MessageModality;
  text: string | null;
  sttConfidence: number | null;
  createdAt: Date;
}

/**
 * 訊息存取的唯一入口。
 *
 * message.text 加密靜態儲存（交接規格 §2.2）。呼叫端不得直接使用
 * TypeORM 的 Message repository —— 那樣會拿到密文或不小心存明文。
 * AdaptersModule 只注入 CryptoPort 給這個 repository。
 *
 * 這個類別只供長者端與內部引擎使用。守護者端的 GuardianViewService
 * 刻意不注入它（交接規格 §6）。
 */
@Injectable()
export class MessageRepository {
  constructor(
    @InjectRepository(Message) private readonly repo: Repository<Message>,
    @Inject(CRYPTO_PORT) private readonly crypto: CryptoPort,
    private readonly consent: ConsentService,
  ) {}

  async append(input: {
    elderId: string;
    direction: MessageDirection;
    modality: MessageModality;
    text?: string | null;
    sttConfidence?: number | null;
    audioRef?: string | null;
    imageRef?: string | null;
  }): Promise<Message> {
    // audio_ref 僅在 voice_retention 授權時保留（交接規格 §2.2）。
    const keepAudio = input.audioRef
      ? await this.consent.has(input.elderId, 'voice_retention')
      : false;

    return this.repo.save(
      this.repo.create({
        elderId: input.elderId,
        direction: input.direction,
        modality: input.modality,
        textEncrypted: input.text ? await this.crypto.encrypt(input.text) : null,
        sttConfidence: input.sttConfidence ?? null,
        audioRef: keepAudio ? input.audioRef : null,
        imageRef: input.imageRef ?? null,
      }),
    );
  }

  /** 近期對話，供組 prompt 使用。 */
  async recentTurns(elderId: string, limit = 10): Promise<DecryptedMessage[]> {
    const rows = await this.repo.find({
      where: { elderId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return Promise.all(rows.reverse().map((row) => this.decrypt(row)));
  }

  /**
   * 資料可攜用（POST /v1/elders/:id/export）。
   * 只有長者本人可呼叫 —— 呼叫端負責驗身分，這裡不做角色判斷，
   * 但方法名稱刻意標明用途，避免被誤用於守護者端。
   */
  async exportAllForElder(elderId: string): Promise<DecryptedMessage[]> {
    const rows = await this.repo.find({ where: { elderId }, order: { createdAt: 'ASC' } });
    return Promise.all(rows.map((row) => this.decrypt(row)));
  }

  /**
   * 刪除訊息不在這裡。
   *
   * 長者行使刪除權時，message 必須與 consent、life_signal 等一起刪，
   * 且要在同一個設有 app.erase_mode 旗標的交易內 —— 見 PrivacyService.confirmErase。
   * 在這裡另開一條刪除路徑，會讓人以為刪訊息可以獨立進行，
   * 結果是 elder 還在、訊息卻沒了，或反過來。
   */

  private async decrypt(row: Message): Promise<DecryptedMessage> {
    return {
      id: row.id,
      direction: row.direction,
      modality: row.modality,
      text: row.textEncrypted ? await this.crypto.decrypt(row.textEncrypted) : null,
      sttConfidence: row.sttConfidence,
      createdAt: row.createdAt,
    };
  }
}
