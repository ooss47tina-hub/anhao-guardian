import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LineInboundEvent, LinePort, LineProfile, LinePushMessage } from 'src/ports/line.port';

const API_BASE = 'https://api.line.me';
const DATA_API_BASE = 'https://api-data.line.me';

/**
 * LINE Messaging API 正式串接。
 *
 * 交接規格 §5：Channel access token、Webhook 簽章驗證、訊息收發與 LIFF 身分。
 */
@Injectable()
export class LineAdapter implements LinePort {
  private readonly logger = new Logger(LineAdapter.name);
  private readonly accessToken: string;
  private readonly channelSecret: string;
  private readonly channelId: string;

  constructor(config: ConfigService) {
    this.accessToken = config.get<string>('line.channelAccessToken') ?? '';
    this.channelSecret = config.get<string>('line.channelSecret') ?? '';
    this.channelId = config.get<string>('line.channelId') ?? '';

    if (!this.accessToken || !this.channelSecret) {
      throw new Error('LINE_CHANNEL_ACCESS_TOKEN 與 LINE_CHANNEL_SECRET 皆為必填');
    }
  }

  /**
   * Webhook 簽章驗證。HMAC-SHA256(channelSecret, rawBody) 的 base64。
   *
   * 必須用原始 body —— 重新 stringify 後的位元組不保證相同（鍵順序、空白），
   * 簽章就會對不起來。見 main.ts 的 rawBody 保存。
   *
   * 用 timingSafeEqual 而非 === ：字串比較會提早返回，理論上可由回應時間
   * 逐位元組推出正確簽章。
   */
  verifySignature(rawBody: Buffer, signature: string): boolean {
    if (!signature) return false;

    const expected = createHmac('SHA256', this.channelSecret).update(rawBody).digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature, 'base64');
    } catch {
      return false;
    }

    // 長度不同時 timingSafeEqual 會拋錯，先擋掉。
    if (received.length !== expected.length) return false;
    return timingSafeEqual(received, expected);
  }

  parseEvents(rawBody: Buffer): LineInboundEvent[] {
    const body = JSON.parse(rawBody.toString('utf8')) as { events?: unknown[] };

    return (body.events ?? [])
      .map((raw) => {
        const e = raw as Record<string, any>;

        // follow：使用者加好友。沒有 message，但需要走到 processor 做綁定引導。
        if (e.type === 'follow') {
          return {
            lineUserId: e.source?.userId as string,
            modality: 'follow' as const,
            replyToken: e.replyToken as string,
            timestamp: (e.timestamp as number) ?? Date.now(),
          };
        }

        if (e.type !== 'message') return null;

        const messageType = e.message?.type as string;
        const modality =
          messageType === 'audio' ? 'audio' : messageType === 'image' ? 'image' : 'text';

        // 貼圖、位置、檔案等不在 MVP 範圍，略過而非當成文字。
        if (!['text', 'audio', 'image'].includes(messageType)) return null;

        return {
          lineUserId: e.source?.userId as string,
          modality,
          text: e.message?.text as string | undefined,
          contentId: e.message?.id as string | undefined,
          replyToken: e.replyToken as string,
          timestamp: (e.timestamp as number) ?? Date.now(),
        };
      })
      .filter((e): e is LineInboundEvent => e !== null && Boolean(e.lineUserId));
  }

  /** 語音／圖片內容走 api-data 網域，且有效期僅數分鐘，收到後要立即下載。 */
  async fetchContent(contentId: string): Promise<{ data: Buffer; mimeType: string }> {
    const res = await fetch(`${DATA_API_BASE}/v2/bot/message/${contentId}/content`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`下載 LINE 內容失敗 ${contentId}：${res.status} ${await res.text()}`);
    }
    return {
      data: Buffer.from(await res.arrayBuffer()),
      mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  /**
   * 主動推播。
   *
   * quickReplies 轉為 LINE 的 quick reply 按鈕 —— 長者按一下就好，
   * 不用打字（高齡友善，SRS 3.3）。LINE 上限 13 個。
   */
  async push(message: LinePushMessage): Promise<void> {
    const body: Record<string, unknown> = {
      to: message.lineUserId,
      messages: [
        {
          type: 'text',
          text: message.text.slice(0, 5000),
          ...(message.quickReplies?.length
            ? {
                quickReply: {
                  items: message.quickReplies.slice(0, 13).map((label) => ({
                    type: 'action',
                    action: { type: 'message', label: label.slice(0, 20), text: label },
                  })),
                },
              }
            : {}),
        },
      ],
    };

    const res = await fetch(`${API_BASE}/v2/bot/message/push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      // 推播失敗不可靜默 —— 家人沒收到通知是這個系統最嚴重的失效模式。
      this.logger.error(`LINE 推播失敗 ${message.lineUserId}：${res.status} ${detail}`);
      throw new Error(`LINE push failed: ${res.status}`);
    }
  }

  /**
   * LIFF id_token 換身分。
   *
   * 交接規格 §3：LIFF 使用 LINE id_token 換發 JWT。
   * 這裡驗證 token 並取回 LINE user id；換發自家 JWT 見 LineAuthGuard 的 TODO(auth)。
   */
  async verifyIdToken(idToken: string): Promise<{ lineUserId: string }> {
    if (!this.channelId) {
      throw new Error('驗證 id_token 需要 LINE_CHANNEL_ID');
    }

    const res = await fetch(`${API_BASE}/oauth2/v2.1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: this.channelId }),
    });

    if (!res.ok) {
      throw new Error(`id_token 驗證失敗：${res.status}`);
    }
    const payload = (await res.json()) as { sub?: string };
    if (!payload.sub) {
      throw new Error('id_token 缺少 sub');
    }
    return { lineUserId: payload.sub };
  }

  async getProfile(lineUserId: string): Promise<LineProfile> {
    const res = await fetch(`${API_BASE}/v2/bot/profile/${lineUserId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      // 取不到名字不該中斷加好友流程 —— 退回空字串，由呼叫端決定預設值。
      this.logger.warn(`取得 LINE profile 失敗 ${lineUserId}：${res.status}`);
      return { lineUserId, displayName: '' };
    }
    const payload = (await res.json()) as { displayName?: string };
    return { lineUserId, displayName: payload.displayName ?? '' };
  }
}
