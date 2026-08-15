'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { createContext, useContext, useEffect, useState } from 'react';
import { api, Me } from '@/lib/api';

/**
 * 版型：左側欄（長者資訊 + G-01～G-05 導覽）+ 主內容。
 * 對應介面原型守護者端桌機版。
 *
 * ElderContext 提供目前檢視的長者 —— 守護者可對應多位長者，
 * MVP 先取第一位（原型也只有陳美玲一位）。
 */

interface ElderContextValue {
  me: Me | null;
  elderId: string | null;
}

const ElderContext = createContext<ElderContextValue>({ me: null, elderId: null });

export function useElder(): ElderContextValue {
  return useContext(ElderContext);
}

const NAV = [
  { href: '/', code: 'G-01', label: '最近好嗎' },
  { href: '/digest', code: 'G-02', label: '本週摘要' },
  { href: '/journeys', code: 'G-04', label: '醫療行程' },
  { href: '/settings', code: 'G-05', label: '設定與授權' },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Me>('/v1/me')
      .then(setMe)
      .catch((e) => setError(String(e)));
  }, []);

  const elder = me?.elders[0] ?? null;
  // birthYear 為 null 代表尚未經 E-00 精靈確認 —— 不顯示年齡，而非顯示一個算出來的假數字。
  const age = elder?.birthYear ? new Date().getFullYear() - elder.birthYear : null;

  return (
    <ElderContext.Provider value={{ me, elderId: elder?.id ?? null }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="elder-card">
            <div className="avatar">{elder?.displayName.slice(-1) ?? '…'}</div>
            <div>
              <div className="elder-name">{elder?.displayName ?? '載入中'}</div>
              <div className="elder-meta">
                {elder
                  ? [
                      // 側欄顯示「這位長者是我的＿＿」：由守護者的 relation 反推。
                      ({ 女兒: '媽媽', 媳婦: '公公' } as Record<string, string>)[elder.relation] ??
                        elder.relation,
                      age ? `${age} 歲` : null,
                      elder.livingAlone ? '獨居' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : ''}
              </div>
            </div>
          </div>

          {/* 桌機直向、手機橫向捲動，兩者共用同一份導覽資料 */}
          <nav className="nav-scroll">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${pathname === item.href ? 'active' : ''}`}
              >
                <span className="code">{item.code}</span>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="sidebar-note">
            這裡不是監控中心。
            <br />
            沒有即時定位、沒有原始數據牆。
          </div>
        </aside>

        <main className="main">
          {error ? (
            <div className="card">
              <h3>無法連到後端</h3>
              <div className="muted">
                請確認後端在 http://localhost:3000 執行中，並已執行 npm run seed。
              </div>
              <div className="muted" style={{ marginTop: 8 }}>{error}</div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </ElderContext.Provider>
  );
}
