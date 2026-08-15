'use client';

import { useEffect, useState } from 'react';
import { api, Journey } from '@/lib/api';
import { useElder } from '@/components/Shell';

const STATUS_LABEL: Record<string, string> = {
  pending: '待確認',
  confirmed: '已確認',
  rescheduling: '改期中',
  done: '已完成',
};

const SOURCE_LABEL: Record<string, string> = {
  chat_extract: '對話萃取',
  ocr: '照片辨識',
  gov_api: '健康存摺',
  manual: '手動建立',
};

interface PublicHealth {
  eligibility: {
    program: string;
    year: number;
    available: boolean;
    lastUsedDate: string | null;
    degraded: boolean;
  } | null;
  labs: Array<{ name: string; value: string; unit: string | null }>;
  dataAsOf: string | null;
}

/**
 * G-04 醫療行程。
 * SRS F4-02：守護者只收到完成狀態與必要摘要，不做全程 GPS 監控。
 * 健檢數值原樣呈現、不判讀（交接規格 §5）。
 */
export default function JourneysPage() {
  const { elderId } = useElder();
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [health, setHealth] = useState<PublicHealth | null>(null);

  useEffect(() => {
    if (!elderId) return;
    api.get<Journey[]>(`/v1/elders/${elderId}/journeys`).then(setJourneys).catch(console.error);
    api.get<PublicHealth>(`/v1/elders/${elderId}/public-health`).then(setHealth).catch(console.error);
  }, [elderId]);

  if (!journeys) return <div className="loading">載入中…</div>;

  return (
    <>
      <h1 className="page-title">醫療行程</h1>
      <div className="page-sub">前一天與當天上午會提醒本人；行程結束由她本人回覆完成狀態</div>

      <div className="card">
        <h3>即將回診</h3>
        {journeys.length === 0 ? (
          <div className="muted">目前沒有已知的回診行程。</div>
        ) : (
          <div className="rows">
            {journeys.map((j) => (
              <div className="row-item" key={j.id}>
                <span className="row-when">
                  {new Date(j.visitAt).toLocaleString('zh-TW', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </span>
                <span className="row-text">
                  {j.hospital} {j.department ?? ''} {j.doctor ? `· ${j.doctor}` : ''}
                  <div className="muted">
                    來源：{SOURCE_LABEL[j.source] ?? j.source}
                    {j.elderConfirmed ? ' · 本人已確認' : ' · 待本人確認'}
                  </div>
                </span>
                <span className={`lvl lvl-${j.status}`}>{STATUS_LABEL[j.status] ?? j.status}</span>
              </div>
            ))}
          </div>
        )}
        <div className="disclaimer">
          行程結束後她只要回一句「順利」，你就會看到完成狀態 — 我們不做全程定位。
        </div>
      </div>

      {health?.eligibility && (
        <div className="card">
          <h3>政府免費健檢（國健署 · 成人預防保健）</h3>
          <p style={{ fontSize: 14.5 }}>
            {health.eligibility.year} 年份{health.eligibility.available ? '尚未使用' : '已使用'}
            {health.eligibility.lastUsedDate && `（上次 ${health.eligibility.lastUsedDate}）`}
          </p>
          {health.eligibility.degraded && (
            <div className="muted">資料未即時更新 — 由上次日期推算，非即時查詢。</div>
          )}
        </div>
      )}

      {health && health.labs.length > 0 && (
        <div className="card">
          <h3>上次健檢的數字（健康存摺{health.dataAsOf ? ` · 資料日期 ${health.dataAsOf}` : ''}）</h3>
          <div className="rows">
            {health.labs.map((lab) => (
              <div className="row-item" key={lab.name}>
                <span className="row-text">{lab.name}</span>
                <span>
                  {lab.value} {lab.unit ?? ''}
                </span>
              </div>
            ))}
          </div>
          <div className="disclaimer">
            數值來自健康存摺，原樣呈現。系統不做判讀，也不因數值異常通知家人。
          </div>
        </div>
      )}
    </>
  );
}
