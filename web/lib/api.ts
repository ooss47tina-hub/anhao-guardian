/**
 * 後端 API 客戶端。
 *
 * 身分：開發時用 FakeLineAdapter 的示範 token（陳怡君）。
 * 正式環境改由 LIFF 取得 id_token —— 只需改 token() 一個函式，
 * 頁面程式碼不動。
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000';

function token(): string {
  // TODO(liff)：正式環境改為 liff.getIDToken()
  return process.env.NEXT_PUBLIC_DEV_TOKEN ?? 'id-token:U-dev-guardian-yijun';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
};

// ── 型別：與後端回應對齊 ─────────────────────────────────

export interface Me {
  role: 'guardian' | 'elder';
  id: string;
  displayName: string;
  elders: Array<{
    id: string;
    displayName: string;
    relation: string;
    isPrimary: boolean;
    birthYear: number | null;
    livingAlone: boolean;
  }>;
}

export interface ElderStatus {
  elderId: string;
  displayName: string;
  status: 'stable' | 'insufficient_data' | 'worth_attention';
  summary: string;
  updatedAt: string;
  /** alertId 只在 pattern_alert 來源的事件上有 —— 醫療行程事件沒有。 */
  recentEvents: Array<{ when: string; text: string; tag: string; alertId?: string }>;
}

export interface Digest {
  id: string;
  weekStart: string;
  headline: string;
  body: string;
  dimensionSummary: Array<{ dimension: string; recent: number; baseline: number }>;
  sentAt: string | null;
  usefulnessFeedback: string | null;
}

export interface AlertDetail {
  id: string;
  level: string;
  headline: string;
  explanation: string;
  createdAt: string;
  versions: { rule: string; model: string; prompt: string };
  baselineSnapshotId: string | null;
  comparison: Array<{ dimension: string; label: string; recent: number; baseline: number }>;
  supportingSignals: Array<{
    dimension: string;
    occurredOn: string;
    confidence: number;
    quote?: string;
  }>;
}

export interface Journey {
  id: string;
  visitAt: string;
  hospital: string;
  department: string | null;
  doctor: string | null;
  source: string;
  elderConfirmed: boolean;
  status: string;
  completedNote: string | null;
}

export interface ConsentState {
  elderId: string;
  grantedScopes: string[];
  canUseService: boolean;
}

export interface PersonaState {
  config: {
    personaName: string;
    templateKey: string;
    elderSalutation: string;
    initiativeLevel: string;
    reminderStyle: string;
  } | null;
  templates: Array<{ key: string; name: string; desc: string }>;
}

export const DIMENSION_LABELS: Record<string, string> = {
  interaction: '互動',
  outing: '外出',
  meal: '飲食',
  social: '社交',
  sleep_subjective: '睡眠',
};
