'use client';

import { useEffect, useState } from 'react';
import { api, ConsentState, PersonaState } from '@/lib/api';
import { useElder } from '@/components/Shell';

const SCOPE_LABELS: Record<string, { label: string; note: string }> = {
  core: { label: '基本使用', note: '必要項目，不開就沒辦法用' },
  pattern_share: { label: '生活變化摘要', note: '「跟平常不一樣」的整理與週摘要' },
  medical: { label: '醫療行程與健檢', note: '回診行程、健檢資格與數值' },
  mood_share: { label: '心情相關訊號', note: '情緒表述的彙整（不含原句）' },
  voice_retention: { label: '語音留存', note: '保留語音檔以改善聽寫' },
  raw_chat_share: { label: '聊天原文', note: '對話原句。預設關閉' },
};

const TEMPLATE_LABELS: Record<string, string> = {
  life_assistant: '生活管家型',
  companion: '貼心陪伴型',
  concise: '簡潔助理型',
  family_bridge: '家庭連結型',
};

/**
 * G-05 設定與授權。
 * 交接規格 §6：授權範圍一律由長者本人在 LINE 確認；守護者只能提出請求。
 * 所以這一頁對授權是「唯讀」—— 沒有任何開關，這是刻意的。
 */
export default function SettingsPage() {
  const { elderId } = useElder();
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [persona, setPersona] = useState<PersonaState | null>(null);

  useEffect(() => {
    if (!elderId) return;
    api.get<ConsentState>(`/v1/elders/${elderId}/consent`).then(setConsent).catch(console.error);
    api.get<PersonaState>(`/v1/elders/${elderId}/persona`).then(setPersona).catch(console.error);
  }, [elderId]);

  if (!consent) return <div className="loading">載入中…</div>;

  return (
    <>
      <h1 className="page-title">設定與授權</h1>
      <div className="page-sub">你可以提出需求，但授權要她本人在 LINE 上按同意才會開啟</div>

      <div className="card">
        <h3>我可以看到什麼</h3>
        <div>
          {Object.entries(SCOPE_LABELS).map(([scope, info]) => {
            const granted = consent.grantedScopes.includes(scope);
            return (
              <div className="row-item" key={scope}>
                <span className={`scope-tag ${granted ? '' : 'off'}`} style={{ margin: 0 }}>
                  {granted ? '✓ ' : '— '}
                  {info.label}
                </span>
                <span className="row-text muted">{info.note}</span>
              </div>
            );
          })}
        </div>
        <div className="disclaimer">
          授權範圍由她本人決定。這一頁沒有任何開關 —— 不是還沒做，是產品原則。
        </div>
      </div>

      <div className="card">
        <h3>通知</h3>
        <div className="rows">
          <div className="row-item">
            <span className="row-text">只在「值得關心」時通知我</span>
            <span className="muted">P2 / P3</span>
          </div>
          <div className="row-item">
            <span className="row-text">安靜時段</span>
            <span className="muted">22:00 – 07:30（高風險除外）</span>
          </div>
          <div className="row-item">
            <span className="row-text">每週摘要</span>
            <span className="muted">週一 09:00</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>AI 生活夥伴</h3>
        {persona?.config ? (
          <div className="rows">
            <div className="row-item">
              <span className="row-text">名字</span>
              <span>{persona.config.personaName}</span>
            </div>
            <div className="row-item">
              <span className="row-text">類型</span>
              <span>{TEMPLATE_LABELS[persona.config.templateKey] ?? persona.config.templateKey}</span>
            </div>
            <div className="row-item">
              <span className="row-text">怎麼稱呼她</span>
              <span>{persona.config.elderSalutation}</span>
            </div>
          </div>
        ) : (
          <div className="muted">尚未設定。</div>
        )}
        <div className="disclaimer">
          你可以幫她選語氣、名字和聲音。涉及家庭分享範圍與身分的部分，仍需她本人在 LINE 確認。
        </div>
      </div>
    </>
  );
}
