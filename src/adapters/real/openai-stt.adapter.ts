import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import * as OpenCC from 'opencc-js';
import { SttAudio, SttPort, SttResult } from 'src/ports/stt.port';

/**
 * 語音轉文字（OpenAI）。
 *
 * 交接規格 §3：「回傳文字與信心值；低於 0.75 要求長者重說，不猜語意。」
 * 這條規則只有在 confidence 真的反映轉寫品質時才有意義 —— 所以這裡從
 * token logprobs 推導真實信心，不回傳常數。
 *
 * 實測（見 test/openai-stt.spec.ts 的門檻說明）：
 *   清晰語音 0.91、極度劣化但仍可辨識 0.998、含糊單字 0.667、純白噪音 0.046。
 * 0.75 門檻剛好切在「聽得懂」與「聽不懂」之間。
 */
@Injectable()
export class OpenAiSttAdapter implements SttPort {
  private readonly logger = new Logger(OpenAiSttAdapter.name);
  private readonly client: OpenAI;
  private readonly model: string;

  /**
   * 簡轉繁（台灣用詞）。
   *
   * 模型對繁簡的輸出不穩定 —— 實測同一段音檔，不給 prompt 時輸出繁體、
   * 給了「請用繁體」的 prompt 反而輸出簡體。prompt 導向在這件事上不可靠，
   * 所以改用決定性的轉換。已是繁體的字不會被動到。
   */
  private readonly toTraditional = OpenCC.Converter({ from: 'cn', to: 'twp' });

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('stt.apiKey') ?? '';
    if (!apiKey) {
      throw new Error('STT 真串接需要 STT_API_KEY（或共用 LLM_API_KEY）');
    }

    this.model = config.get<string>('stt.model') || 'gpt-4o-transcribe';
    this.client = new OpenAI({
      apiKey,
      baseURL: config.get<string>('stt.baseUrl') || undefined,
      maxRetries: 2,
    });
  }

  async transcribe(audio: SttAudio): Promise<SttResult> {
    const file = await toFile(audio.data, this.fileName(audio.mimeType), {
      type: audio.mimeType,
    });

    const response = (await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      language: 'zh',
      response_format: 'json',
      include: ['logprobs'],
    })) as { text?: string; logprobs?: Array<{ logprob: number }> };

    const rawText = (response.text ?? '').trim();
    const confidence = this.deriveConfidence(response.logprobs);
    const text = this.toTraditional(rawText);

    // 聽不清時模型會漂到別的語言 —— 實測純白噪音得到「サンバ。」、
    // 含糊單字得到「うん。」。這兩例的信心值都夠低（0.046 / 0.667），
    // 但不能只靠信心值：轉寫成日文的內容若僥倖高信心，會被當成長者說的話。
    if (text && !this.looksLikeChinese(text)) {
      this.logger.warn(`轉寫結果非中文，視為聽不清：「${text}」`);
      return { text: '', confidence: 0, language: 'zh-TW' };
    }

    if (rawText !== text) {
      this.logger.debug(`簡轉繁：「${rawText}」→「${text}」`);
    }

    return { text, confidence, language: 'zh-TW' };
  }

  /**
   * 由 token logprobs 推導信心值。
   *
   * 用平均 logprob 取指數（＝逐 token 機率的幾何平均）而非算術平均：
   * 幾何平均對「其中一個 token 很不確定」敏感，算術平均會被其他確定的
   * token 稀釋掉。一句話裡有一個字聽錯，整句的語意就可能反過來。
   *
   * 沒有 logprobs 時回傳 0 —— 寧可讓長者重說一次，也不要拿一個
   * 編造的信心值去通過 0.75 門檻。
   */
  private deriveConfidence(logprobs?: Array<{ logprob: number }>): number {
    if (!logprobs?.length) {
      this.logger.warn('轉寫回應沒有 logprobs，無法評估信心值');
      return 0;
    }
    const mean = logprobs.reduce((sum, t) => sum + t.logprob, 0) / logprobs.length;
    return Number(Math.exp(mean).toFixed(4));
  }

  /**
   * 中文字符檢查。
   * 要求至少一個 CJK 漢字，且不含日文假名或韓文字母 ——
   * 那是模型在聽不清時漂到別的語言的訊號。
   */
  private looksLikeChinese(text: string): boolean {
    const hasHan = /[一-鿿]/.test(text);
    const hasKanaOrHangul = /[぀-ヿ가-힯]/.test(text);
    return hasHan && !hasKanaOrHangul;
  }

  /** OpenAI 依副檔名判斷格式，必須給對。 */
  private fileName(mimeType: string): string {
    const ext =
      {
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/mp4': 'mp4',
        'audio/m4a': 'm4a',
        'audio/x-m4a': 'm4a',
        'audio/aac': 'm4a',
        'audio/wav': 'wav',
        'audio/x-wav': 'wav',
        'audio/webm': 'webm',
        'audio/ogg': 'ogg',
        'audio/flac': 'flac',
      }[mimeType.split(';')[0].trim().toLowerCase()] ?? 'm4a';
    return `audio.${ext}`;
  }
}
