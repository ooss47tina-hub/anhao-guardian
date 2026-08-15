import { Injectable, Logger } from '@nestjs/common';
import { LineInboundEvent, LinePort, LineProfile, LinePushMessage } from 'src/ports/line.port';

/**
 * 假 LINE。推播寫入記憶體，測試可據此斷言「該通知的有通知、不該通知的沒通知」。
 *
 * verifySignature 在 fake 模式仍要求 signature 非空 —— 保留這道檢查，
 * 是為了讓 webhook 路由的錯誤處理路徑在測試中真的被走到。
 */
@Injectable()
export class FakeLineAdapter implements LinePort {
  private readonly logger = new Logger(FakeLineAdapter.name);
  readonly pushed: LinePushMessage[] = [];

  verifySignature(_rawBody: Buffer, signature: string): boolean {
    return Boolean(signature);
  }

  parseEvents(rawBody: Buffer): LineInboundEvent[] {
    const body = JSON.parse(rawBody.toString('utf8')) as { events?: unknown[] };
    return (body.events ?? []).map((raw) => {
      const e = raw as Record<string, any>;
      const type = e.message?.type as string;
      return {
        lineUserId: e.source?.userId ?? 'U-fake-elder',
        modality: type === 'audio' ? 'audio' : type === 'image' ? 'image' : 'text',
        text: e.message?.text,
        contentId: e.message?.id,
        replyToken: e.replyToken ?? 'fake-reply-token',
        timestamp: e.timestamp ?? Date.now(),
      };
    });
  }

  async fetchContent(contentId: string): Promise<{ data: Buffer; mimeType: string }> {
    return { data: Buffer.from(`fake-content:${contentId}`), mimeType: 'application/octet-stream' };
  }

  async push(message: LinePushMessage): Promise<void> {
    this.pushed.push(message);
    this.logger.debug(`push → ${message.lineUserId}: ${message.text}`);
  }

  async verifyIdToken(idToken: string): Promise<{ lineUserId: string }> {
    // 測試以 "id-token:<lineUserId>" 形式指定身分。
    const [, lineUserId] = idToken.split(':');
    if (!lineUserId) throw new Error('無效的 id_token');
    return { lineUserId };
  }

  async getProfile(lineUserId: string): Promise<LineProfile> {
    return { lineUserId, displayName: `測試使用者-${lineUserId.slice(-4)}` };
  }

  reset(): void {
    this.pushed.length = 0;
  }
}
