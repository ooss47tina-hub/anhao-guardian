'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Digest, DIMENSION_LABELS, ElderStatus } from '@/lib/api';
import { useElder } from '@/components/Shell';

/**
 * G-02 本週摘要（Family Digest）。
 * SRS F3-02：整體狀態、與 Baseline 相比的變化、重要行程、需家人處理事項。
 * 回饋按鈕作為模型與閾值調校資料。
 */
export default function DigestPage() {
  const { elderId } = useElder();
  const [digest, setDigest] = useState<Digest | null | 'none'>(null);
  const [status, setStatus] = useState<ElderStatus | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!elderId) return;
    api
      .get<Digest | null>(`/v1/elders/${elderId}/digest`)
      .then((d) => {
        setDigest(d ?? 'none');
        setFeedback(d?.usefulnessFeedback ?? null);
      })
      .catch(console.error);
    api.get<ElderStatus>(`/v1/elders/${elderId}/status`).then(setStatus).catch(console.error);
  }, [elderId]);

  if (digest === null) return <div className="loading">載入中…</div>;

  if (digest === 'none') {
    return (
      <>
        <h1 className="page-title">本週摘要</h1>
        <div className="card">
          <div className="muted">本週摘要尚未產生（每週一 09:00 產生）。</div>
        </div>
      </>
    );
  }

  // 摘要統計的是「剛結束的那一週」：[weekStart-7, weekStart)，
  // 與 DigestService.build 的查詢視窗一致。原本顯示 weekStart 起算的
  // 未來一週，會跟首頁「最近 7 天」的數字互相矛盾。
  const weekFrom = new Date(digest.weekStart);
  weekFrom.setDate(weekFrom.getDate() - 7);
  const weekEnd = new Date(digest.weekStart);
  weekEnd.setDate(weekEnd.getDate() - 1);
  const fmt = (d: Date | string) =>
    new Date(d).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
  const max = Math.max(...digest.dimensionSummary.map((x) => Math.max(x.recent, x.baseline)), 1);
  const latestAlert = status?.recentEvents.find((e) => e.alertId);

  async function sendFeedback(value: 'helpful' | 'inaccurate' | 'mute_this_type') {
    if (digest === null || digest === 'none') return;
    await api.post(`/v1/digests/${digest.id}/feedback`, { feedback: value });
    setFeedback(value);
  }

  return (
    <>
      <h1 className="page-title">
        {fmt(weekFrom)} – {fmt(weekEnd)}　週摘要
      </h1>
      <div className="page-sub">每週一 09:00 產生，內容不含聊天原文</div>

      <div className="card">
        <p className="summary-line" style={{ marginTop: 0 }}>
          {digest.headline}
        </p>
        <div style={{ fontSize: 14, color: 'var(--ink-2)' }}>{digest.body}</div>

        <h3 style={{ marginTop: 20 }}>和平常比較</h3>
        {digest.dimensionSummary.map((d) => (
          <div className="dim-row" key={d.dimension}>
            <span className="dim-label">{DIMENSION_LABELS[d.dimension] ?? d.dimension}</span>
            <span className="dim-track">
              <span className="dim-base" style={{ width: `${(d.baseline / max) * 100}%` }} />
              <span className="dim-recent" style={{ width: `${(d.recent / max) * 100}%` }} />
            </span>
            <span className="dim-num">
              {d.recent} 次 / 平常 {d.baseline}
            </span>
          </div>
        ))}
        <div className="muted" style={{ marginTop: 6 }}>
          深色為該週，淺色為個人平常水準（近 28 天 Baseline）。
        </div>

        {latestAlert && (
          <div className="btn-row">
            <Link href={`/alerts/${latestAlert.alertId}`} className="btn btn-ghost">
              看看發生什麼變化
            </Link>
          </div>
        )}
      </div>

      <div className="card">
        <h3>這份摘要對你有幫助嗎？</h3>
        {feedback ? (
          <div className="muted">
            已收到你的回饋（
            {feedback === 'helpful' ? '有幫助' : feedback === 'inaccurate' ? '不太準' : '這種不用提醒'}
            ）。我們會用它調整摘要的內容與頻率。
          </div>
        ) : (
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button className="btn-ghost" onClick={() => sendFeedback('helpful')}>
              有幫助
            </button>
            <button className="btn-quiet" onClick={() => sendFeedback('inaccurate')}>
              不太準
            </button>
            <button className="btn-quiet" onClick={() => sendFeedback('mute_this_type')}>
              這種不用提醒我
            </button>
          </div>
        )}
      </div>
    </>
  );
}
