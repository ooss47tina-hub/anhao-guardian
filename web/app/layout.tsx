import type { Metadata } from 'next';
import Shell from '@/components/Shell';
import './globals.css';

export const metadata: Metadata = {
  title: '安好 · 守護者',
  description: '媽媽最近是不是跟平常一樣',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
