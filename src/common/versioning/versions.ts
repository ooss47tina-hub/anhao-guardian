/**
 * 版本註冊表。
 *
 * 交接規格第 6 節：「每一則通知都要能回溯規則版本、模型版本與 baseline 快照。」
 * 任何寫入 pattern_alert 或 life_signal 的路徑都必須帶上這裡的值，
 * 不得留空、不得寫死在呼叫端。
 */
export const VERSIONS = {
  /** Pattern Engine 規則版本。規則邏輯每次變更都要進版。 */
  rule: 'rule-v1.3',

  /** LLM 模型版本。換模型必須進版，否則舊通知無法重現。 */
  model: 'llm-2026-07',

  /** Prompt 版本。Prompt 文字每次變更都要進版。 */
  prompt: 'prompt-v2.1',

  /** Life Signal 萃取器版本，寫入 life_signal.extractor_version。 */
  extractor: 'extractor-v1.2',

  /** 同意書版本，寫入 consent.consent_version。 */
  consent: 'consent-v2.1',
} as const;

export type VersionSet = {
  ruleVersion: string;
  modelVersion: string;
  promptVersion: string;
};

export function currentVersionSet(): VersionSet {
  return {
    ruleVersion: VERSIONS.rule,
    modelVersion: VERSIONS.model,
    promptVersion: VERSIONS.prompt,
  };
}
