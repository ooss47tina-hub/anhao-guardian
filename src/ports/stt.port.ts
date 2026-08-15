export const STT_PORT = Symbol('SttPort');

export interface SttResult {
  text: string;
  /** 交接規格第 3 節：低於 0.75 要求長者重說，不猜語意。 */
  confidence: number;
  /** zh-TW。台語列 Phase 1.5（SRS 3.2）。 */
  language: string;
}

export interface SttPort {
  transcribe(audio: { ref: string; mimeType: string }): Promise<SttResult>;
}
