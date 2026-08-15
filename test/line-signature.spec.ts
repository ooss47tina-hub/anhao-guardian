import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { LineAdapter } from 'src/adapters/real/line.adapter';

/**
 * LINE Webhook 簽章驗證。
 *
 * 交接規格 §5：Webhook 簽章驗證。
 * 這是系統唯一對外開放、且不需登入的入口 —— 驗證錯了等於任何人都能
 * 偽造長者訊息、觸發高風險通知。
 */
describe('LINE 簽章驗證', () => {
  const SECRET = 'test-channel-secret';

  function adapter(): LineAdapter {
    const values: Record<string, string> = {
      'line.channelAccessToken': 'test-token',
      'line.channelSecret': SECRET,
      'line.channelId': '1234567890',
    };
    return new LineAdapter({ get: (k: string) => values[k] } as ConfigService);
  }

  function sign(body: Buffer, secret = SECRET): string {
    return createHmac('SHA256', secret).update(body).digest('base64');
  }

  const body = Buffer.from(
    JSON.stringify({ events: [{ type: 'message', message: { type: 'text', text: '你好' } }] }),
  );

  it('正確簽章通過', () => {
    expect(adapter().verifySignature(body, sign(body))).toBe(true);
  });

  it('錯誤的 channel secret 不通過', () => {
    expect(adapter().verifySignature(body, sign(body, 'wrong-secret'))).toBe(false);
  });

  it('body 被竄改後不通過', () => {
    const signature = sign(body);
    const tampered = Buffer.from(
      JSON.stringify({ events: [{ type: 'message', message: { type: 'text', text: '我跌倒了' } }] }),
    );
    expect(adapter().verifySignature(tampered, signature)).toBe(false);
  });

  it('空簽章不通過', () => {
    expect(adapter().verifySignature(body, '')).toBe(false);
  });

  it('長度不符的簽章不通過，且不拋錯', () => {
    expect(() => adapter().verifySignature(body, 'YWJj')).not.toThrow();
    expect(adapter().verifySignature(body, 'YWJj')).toBe(false);
  });

  it('非 base64 的簽章不通過，且不拋錯', () => {
    expect(() => adapter().verifySignature(body, '!!!not-base64!!!')).not.toThrow();
    expect(adapter().verifySignature(body, '!!!not-base64!!!')).toBe(false);
  });

  it('缺少必要設定時拒絕啟動', () => {
    expect(
      () => new LineAdapter({ get: () => '' } as unknown as ConfigService),
    ).toThrow(/皆為必填/);
  });
});

/**
 * 事件解析。貼圖、位置等非 MVP 範圍的訊息型別必須被略過，
 * 不可當成空文字送進 LLM —— 那會產生假的 interaction 訊號污染 Baseline。
 */
describe('LINE 事件解析', () => {
  function adapter(): LineAdapter {
    const values: Record<string, string> = {
      'line.channelAccessToken': 't',
      'line.channelSecret': 's',
      'line.channelId': 'c',
    };
    return new LineAdapter({ get: (k: string) => values[k] } as ConfigService);
  }

  function parse(events: unknown[]) {
    return adapter().parseEvents(Buffer.from(JSON.stringify({ events })));
  }

  it('解析文字訊息', () => {
    const result = parse([
      {
        type: 'message',
        source: { userId: 'U123' },
        message: { type: 'text', text: '今天去市場' },
        replyToken: 'rt',
        timestamp: 1755000000000,
      },
    ]);
    expect(result).toEqual([
      {
        lineUserId: 'U123',
        modality: 'text',
        text: '今天去市場',
        contentId: undefined,
        replyToken: 'rt',
        timestamp: 1755000000000,
      },
    ]);
  });

  it('解析語音與圖片，帶 contentId', () => {
    const result = parse([
      { type: 'message', source: { userId: 'U1' }, message: { type: 'audio', id: 'm1' }, replyToken: 'r' },
      { type: 'message', source: { userId: 'U1' }, message: { type: 'image', id: 'm2' }, replyToken: 'r' },
    ]);
    expect(result.map((e) => [e.modality, e.contentId])).toEqual([
      ['audio', 'm1'],
      ['image', 'm2'],
    ]);
  });

  it('解析 follow 事件', () => {
    const result = parse([{ type: 'follow', source: { userId: 'U9' }, replyToken: 'r' }]);
    expect(result[0].modality).toBe('follow');
    expect(result[0].lineUserId).toBe('U9');
  });

  it('略過貼圖、位置等非支援型別', () => {
    const result = parse([
      { type: 'message', source: { userId: 'U1' }, message: { type: 'sticker' }, replyToken: 'r' },
      { type: 'message', source: { userId: 'U1' }, message: { type: 'location' }, replyToken: 'r' },
      { type: 'message', source: { userId: 'U1' }, message: { type: 'file' }, replyToken: 'r' },
    ]);
    expect(result).toHaveLength(0);
  });

  it('略過 unfollow、join 等非訊息事件', () => {
    const result = parse([
      { type: 'unfollow', source: { userId: 'U1' } },
      { type: 'join', source: { groupId: 'G1' } },
    ]);
    expect(result).toHaveLength(0);
  });

  it('略過沒有 userId 的事件（群組訊息等）', () => {
    const result = parse([
      { type: 'message', source: { groupId: 'G1' }, message: { type: 'text', text: 'hi' }, replyToken: 'r' },
    ]);
    expect(result).toHaveLength(0);
  });
});
