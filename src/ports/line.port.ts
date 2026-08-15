export const LINE_PORT = Symbol('LinePort');

export type LineMessageModality = 'text' | 'audio' | 'image';

export interface LineInboundEvent {
  lineUserId: string;
  modality: LineMessageModality;
  text?: string;
  /** 語音／圖片的 LINE content id，需另行下載至物件儲存。 */
  contentId?: string;
  replyToken: string;
  timestamp: number;
}

export interface LinePushMessage {
  lineUserId: string;
  text: string;
  /** 選填的快速回覆按鈕，例如「我會去／要改期」。 */
  quickReplies?: string[];
}

export interface LinePort {
  /**
   * 驗證 Webhook 簽章。
   * 交接規格第 3 節：簽章驗證後入 queue，3 秒內回 200。
   * 驗證失敗必須拒絕，不得為了方便測試而略過。
   */
  verifySignature(rawBody: Buffer, signature: string): boolean;

  parseEvents(rawBody: Buffer): LineInboundEvent[];

  /** 下載語音／圖片內容。 */
  fetchContent(contentId: string): Promise<{ data: Buffer; mimeType: string }>;

  push(message: LinePushMessage): Promise<void>;

  /** 以 LIFF id_token 換取 LINE 身分，用於守護者端與長者本人同意驗證。 */
  verifyIdToken(idToken: string): Promise<{ lineUserId: string }>;
}
