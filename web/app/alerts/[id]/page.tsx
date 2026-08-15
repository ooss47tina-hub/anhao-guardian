'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, AlertDetail } from '@/lib/api';
import { useElder } from '@/components/Shell';

/**
 * G-03 變化詳情。
 * 變化維度、Baseline 對照、支持訊號、建議下一步（SRS 8.2）。
 * 所有 AI 推論都可展開查看「為什麼這樣判斷」（SRS 8.3）。
 */
export default function AlertPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useElder();
  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [acked, setAcked] = useState<string | null>(null);

  useEffect(() => {
    api.get<AlertDetail>(`/v1/alerts/${id}`).then(setAlert).catch(console.error);
  }, [id]);

  if (!alert) return <div className="loading">載入中…</div>;

  const max = Math.max(...alert.comparison.map((c) => Math.max(c.recent, c.baseline)), 1);

  async function ack(action: 'contacted' | 'inaccurate' | 'mute_this_type') {
    await api.post(`/v1/alerts/${id}/ack`, {
      action,
      feedback:
        action === 'contacted' ? 'helpful' : action === 'inaccurate' ? 'inaccurate' : 'mute_this_type',
    });
    setAcked(action);
  }

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <span className={`lvl lvl-${alert.level}`}>
          {alert.level} · {alert.level === 'P3' ? '高風險' : '值得關心'}
        </span>
      </div>
      <h1 className="page-title">{alert.headline}</h1>
      <div className="page-sub">
        產生於 {new Date(alert.createdAt).toLocaleString('zh-TW', { hour12: false })} ·{' '}
        {alert.versions.rule} · {alert.versions.model}
      </div>

      <div className="card">
        <h3>和自己平常比較（近 28 天 Baseline）</h3>
        {alert.comparison.map((c) => (
          <div className="dim-row" key={c.dimension}>
            <span className="dim-label">{c.label}</span>
            <span className="dim-track">
              <span className="dim-base" style={{ width: `${(c.baseline / max) * 100}%` }} />
              <span className="dim-recent" style={{ width: `${(c.recent / max) * 100}%` }} />
            </span>
            <span className="dim-num">
              本週 {c.recent} / 平常 {c.baseline}
            </span>
          </div>
        ))}
        <div className="muted" style={{ marginTop: 6 }}>
          深色為本週，淺色為個人平常水準。不與其他長者比較。
        </div>
      </div>

      <div className="card">
        <details>
          <summary>為什麼這樣判斷？</summary>
          <p style={{ fontSize: 14.5, marginBottom: 12 }}>{alert.explanation}</p>
          {alert.supportingSignals.slice(0, 8).map((s, i) => (
            <div className="quote" key={i}>
              <span className="muted">
                {s.occurredOn} · {s.dimension} · 信心 {s.confidence}
              </span>
              {s.quote && <div>「{s.quote}」</div>}
            </div>
          ))}
          {!alert.supportingSignals.some((s) => s.quote) && (
            <div className="muted">
              訊號原句未開放 —— 需要長者本人開啟 raw_chat_share 授權才會顯示。
            </div>
          )}
        </details>
        <div className="disclaimer">這不是醫療判斷，也不是診斷。只是「和平常不一樣」。</div>
      </div>

      <div className="card">
        <h3>建議的下一步</h3>
        <ol className="next-steps">
          <li>打個電話，聊天氣和日常，不要一開口就問身體。</li>
          <li>如果近期有回診，可以把觀察到的變化順口跟醫師提一下。</li>
          <li>如果持續兩週沒有回到平常，我們會再提醒你一次。</li>
        </ol>
        {acked ? (
          <div className="muted" style={{ marginTop: 12 }}>
            已記錄（
            {acked === 'contacted' ? '已聯絡' : acked === 'inaccurate' ? '判斷不準' : '不用再提醒'}
            ）。你的回饋會用來調整判斷門檻。
          </div>
        ) : (
          <div className="btn-row">
            {/* 用長者稱呼組按鈕文字 —— 原型寫死「媽媽」，換示範長者就穿幫。 */}
            <button onClick={() => ack('contacted')}>
              我已聯絡{me?.elders[0]?.displayName.slice(1) ?? '家人'}
            </button>
            <button className="btn-quiet" onClick={() => ack('inaccurate')}>
              這次判斷不準
            </button>
            <button className="btn-quiet" onClick={() => ack('mute_this_type')}>
              這類不用再提醒
            </button>
          </div>
        )}
      </div>
    </>
  );
}
