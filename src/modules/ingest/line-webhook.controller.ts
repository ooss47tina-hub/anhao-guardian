import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { LINE_PORT, LinePort } from 'src/ports/line.port';
import { IngestQueue } from './ingest.queue';

/**
 * POST /webhook/line
 *
 * 交接規格 §3：「文字／語音／圖片入口，簽章驗證後入 queue，3 秒內回 200」。
 *
 * 這個 controller 只做三件事：驗簽、入佇列、回 200。
 * 任何 LLM／STT／OCR 呼叫都不得放在這裡 —— 那會讓回應時間超過 LINE 的容忍值，
 * 導致 LINE 重送，長者就會收到重複回話。
 */
@Controller('webhook')
export class LineWebhookController {
  private readonly logger = new Logger(LineWebhookController.name);

  constructor(
    @Inject(LINE_PORT) private readonly line: LinePort,
    private readonly queue: IngestQueue,
  ) {}

  @Post('line')
  @HttpCode(200)
  async handle(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-line-signature') signature: string,
  ): Promise<{ ok: true }> {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

    if (!signature || !this.line.verifySignature(rawBody, signature)) {
      // 驗簽失敗一律拒絕。不得為了除錯方便而放行。
      throw new BadRequestException('LINE 簽章驗證失敗');
    }

    const events = this.line.parseEvents(rawBody);
    await Promise.all(events.map((event) => this.queue.enqueue(event)));

    this.logger.debug(`收到 ${events.length} 個 LINE 事件，已入佇列`);
    return { ok: true };
  }
}
