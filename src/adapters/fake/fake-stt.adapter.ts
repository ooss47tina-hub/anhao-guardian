import { Injectable } from '@nestjs/common';
import { SttPort, SttResult } from 'src/ports/stt.port';

/**
 * 假 STT。以 ref 中的標記決定回傳，讓「低信心要求重說」這條路徑可被測試。
 *
 * ref 含 "lowconf" → confidence 0.42（應觸發請長者重說，不猜語意）
 * 其他 → confidence 0.93
 */
@Injectable()
export class FakeSttAdapter implements SttPort {
  private readonly transcripts = new Map<string, string>();

  /** 測試可預先塞入指定 ref 的逐字稿。 */
  seed(ref: string, text: string): void {
    this.transcripts.set(ref, text);
  }

  async transcribe(audio: { ref: string; mimeType: string }): Promise<SttResult> {
    const lowConfidence = audio.ref.includes('lowconf');
    return {
      text: this.transcripts.get(audio.ref) ?? '今天早上我去市場買菜',
      confidence: lowConfidence ? 0.42 : 0.93,
      language: 'zh-TW',
    };
  }
}
