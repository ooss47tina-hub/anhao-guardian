'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ElderStatus } from '@/lib/api';
import { useElder } from '@/components/Shell';

const STATUS_LABEL: Record<ElderStatus['status'], string> = {
  stable: '穩定',
  insufficient_data: '資料不足',
  worth_attention: '值得關心',
};

/**
 * 事件標籤。recentEvents 混合了 pattern_alert（P0–P3）與 medical_journey
 * （pending/confirmed/…），後端回的是原始值，這裡統一轉成中文。
 */
const TAG_LABEL: Record<string, string> = {
  P0: '正常',
  P1: '觀察',
  P2: '值得關心',
  P3: '高風險',
  pending: '待確認',
  confirmed: '已確認',
  rescheduling: '改期中',
  done: '已完成',
};

/**
 * G-01 最近好嗎。
 * SRS F3-01：首頁只做三件事 —— 一個狀態、一句摘要、最近重要事件。
 * 不放心情分數、步數等 raw metrics。
 */
export default function HomePage() {
  const { elderId } = useElder();
  const [status, setStatus] = useState<ElderStatus | null>(null);

  useEffect(() => {
    if (!elderId) return;
    api.get<ElderStatus>(`/v1/elders/${elderId}/status`).then(setStatus).catch(console.error);
  }, [elderId]);

  if (!status) return <div className="loading">載入中…</div>;

  const latestAlert = status.recentEvents.find((e) => e.tag === 'P2' || e.tag === 'P3');

  return (
    <>
      <h1 className="page-title">
        {status.displayName.slice(1)}
        {status.displayName && '，最近好嗎'}
      </h1>
      <div className="page-sub">
        更新於 {new Date(status.updatedAt).toLocaleString('zh-TW', { hour12: false })}
      </div>

      <div className="card">
        <span className={`status-pill st-${status.status}`}>{STATUS_LABEL[status.status]}</span>
        <p className="summary-line">{status.summary}</p>
        {latestAlert && status.status === 'worth_attention' && (
          <div className="btn-row">
            <Link href="/digest" className="btn btn-ghost">
              看看發生什麼變化
            </Link>
          </div>
        )}
      </div>

      <div className="card">
        <h3>最近重要的事</h3>
        {status.recentEvents.length === 0 ? (
          <div className="muted">目前沒有需要留意的事。</div>
        ) : (
          <div className="rows">
            {status.recentEvents.map((event, i) => (
              <div className="row-item" key={i}>
                <span className="row-when">{event.when}</span>
                <span className="row-text">{event.text}</span>
                <span className={`lvl lvl-${event.tag}`}>
                  {TAG_LABEL[event.tag] ?? event.tag}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="disclaimer">
        我們只把「跟平常不一樣」的部分整理給你，聊天內容本身不會轉給家人。
      </div>
    </>
  );
}
