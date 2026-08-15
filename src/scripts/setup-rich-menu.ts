import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';

loadEnv();

/**
 * 建立長者端 Rich Menu（E-01）。
 *
 *   npm run line:richmenu
 *
 * SRS 8.1：3 格即可 —— 跟我說／我的行程／找家人。
 * 高齡友善：按鈕 ≥48px、字級大、不做深層選單（SRS 3.3）。
 *
 * 需要一張 2500×843 的圖片。沒有設計稿時本腳本會產生一張純色底、
 * 三格分隔的暫用圖，先讓流程能跑；正式版請由設計提供。
 */

const API = 'https://api.line.me';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '';

const RICH_MENU = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: '安好主選單',
  chatBarText: '選單',
  areas: [
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: 'message', label: '跟我說', text: '我想跟你說話' },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: { type: 'message', label: '我的行程', text: '我最近有什麼事' },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: 'message', label: '找家人', text: '我想找家人' },
    },
  ],
};

/** 暫用圖：深綠底、白色分隔線與三個標籤。用 SVG 轉 PNG 需額外套件，故直接產 PNG 太複雜 —— 改用純色 JPEG。 */
function placeholderImage(): Buffer {
  // 最小可用的 2500×843 純色 JPEG。LINE 只驗尺寸與格式，內容不影響功能測試。
  // 正式版請換成設計稿。
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  const path = '/tmp/anhao-richmenu.jpg';
  // macOS 內建 sips 無法從無到有產圖，改用 Node 手寫最小 JPEG 過於複雜，
  // 這裡用 ImageMagick（若有）或提示使用者自備圖片。
  try {
    execSync(
      `magick -size 2500x843 xc:'#2E6152' ` +
        `-fill white -stroke white -strokewidth 4 ` +
        `-draw "line 833,80 833,763" -draw "line 1667,80 1667,763" ` +
        `-pointsize 90 -gravity NorthWest ` +
        `-annotate +280+370 '跟我說' -annotate +1110+370 '我的行程' -annotate +1990+370 '找家人' ` +
        `${path}`,
      { stdio: 'pipe' },
    );
    return require('node:fs').readFileSync(path) as Buffer;
  } catch {
    throw new Error(
      '找不到 ImageMagick，無法產生暫用圖。\n' +
        '請改為：brew install imagemagick，或自行準備一張 2500×843 的 JPEG，\n' +
        '放到 /tmp/anhao-richmenu.jpg 後重跑本指令。',
    );
  }
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('缺少 LINE_CHANNEL_ACCESS_TOKEN。請先填 .env。');
    process.exit(1);
  }

  // 舊的先刪，避免每次執行都累積一個新選單。
  const listRes = await fetch(`${API}/v2/bot/richmenu/list`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const list = (await listRes.json()) as { richmenus?: Array<{ richMenuId: string }> };
  for (const menu of list.richmenus ?? []) {
    await fetch(`${API}/v2/bot/richmenu/${menu.richMenuId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    console.log(`已刪除舊選單 ${menu.richMenuId}`);
  }

  const createRes = await fetch(`${API}/v2/bot/richmenu`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(RICH_MENU),
  });
  if (!createRes.ok) {
    console.error('建立失敗：', await createRes.text());
    process.exit(1);
  }
  const { richMenuId } = (await createRes.json()) as { richMenuId: string };
  console.log(`已建立選單 ${richMenuId}`);

  const image = require('node:fs').existsSync('/tmp/anhao-richmenu.jpg')
    ? (require('node:fs').readFileSync('/tmp/anhao-richmenu.jpg') as Buffer)
    : placeholderImage();

  const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/jpeg' },
    body: new Uint8Array(image),
  });
  if (!uploadRes.ok) {
    console.error('上傳圖片失敗：', await uploadRes.text());
    process.exit(1);
  }
  console.log('已上傳選單圖片');

  const defaultRes = await fetch(`${API}/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!defaultRes.ok) {
    console.error('設為預設失敗：', await defaultRes.text());
    process.exit(1);
  }
  console.log('已設為所有使用者的預設選單。到 LINE 對話視窗即可看到。');
}

void main();
