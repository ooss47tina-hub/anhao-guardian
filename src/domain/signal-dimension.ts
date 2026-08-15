/**
 * Life Signal 維度。
 * 交接規格 2.2 life_signal.dimension 的封閉列舉。
 */
export const SIGNAL_DIMENSIONS = [
  'interaction',
  'outing',
  'meal',
  'sleep_subjective',
  'social',
  'mood',
  'concern',
  'task',
] as const;

export type SignalDimension = (typeof SIGNAL_DIMENSIONS)[number];

/**
 * Baseline 第一版只追蹤四個維度（SRS F2-01）。
 * 其餘維度仍會萃取與儲存，但不進 Baseline 統計、不參與 Pattern 判斷。
 */
export const BASELINE_DIMENSIONS: SignalDimension[] = [
  'interaction',
  'outing',
  'meal',
  'social',
];

/**
 * Baseline 只計入「事情真的發生了」的訊號值。
 *
 * Baseline 與 Pattern 都是按維度數「筆數」，不看 value —— 所以一筆
 * outing=stayed_home（待在家）會被當成一次外出，把基線灌高，
 * 接著讓「近 7 天外出變少」的判斷失準。負向訊號仍然儲存（它有臨床參考價值，
 * 也供人工抽查），只是不進統計。
 *
 * 新增 value 前先想清楚：它代表「這件事發生了」還是「這件事沒發生」。
 */
export const POSITIVE_SIGNAL_VALUES: Record<SignalDimension, string[]> = {
  interaction: ['checked_in'],
  outing: ['went_out'],
  meal: ['ate'],
  social: ['met_someone'],
  // 以下三個維度不進 Baseline 統計，列出僅為完整性。
  sleep_subjective: [],
  mood: [],
  concern: [],
  task: [],
};

/** 供 SQL IN 子句使用的扁平清單（只含四個 Baseline 維度）。 */
export const BASELINE_POSITIVE_VALUES: string[] = BASELINE_DIMENSIONS.flatMap(
  (d) => POSITIVE_SIGNAL_VALUES[d],
);

export const DIMENSION_LABELS: Record<SignalDimension, string> = {
  interaction: '互動',
  outing: '外出',
  meal: '飲食',
  sleep_subjective: '睡眠',
  social: '社交',
  mood: '情緒',
  concern: '擔憂',
  task: '待辦',
};

/** Pattern 分級。交接規格 2.3 pattern_alert.level。 */
export const ALERT_LEVELS = ['P0', 'P1', 'P2', 'P3'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/**
 * 只有 P2／P3 及明確待辦推播守護者（交接規格第 1 節 Notify、SRS F3-03）。
 * P0／P1 一律不打擾。
 */
export function isNotifiableLevel(level: AlertLevel): boolean {
  return level === 'P2' || level === 'P3';
}

/** P3 為高風險，不受安靜時段限制（交接規格第 4 節 safety_rule）。 */
export function bypassesQuietHours(level: AlertLevel): boolean {
  return level === 'P3';
}
