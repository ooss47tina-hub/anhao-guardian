/**
 * /dev 檢視頁的 HTML。單檔、無外部依賴，直接由 DevController 回傳。
 *
 * 配色取自介面原型（深綠 #2E6152 / 米白 #F3EEE6）。
 * 這不是正式前端 —— 只求把後端資料流變成看得到的畫面。
 */
export const DEV_CONSOLE_HTML = /* html */ `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>安好 · 開發檢視頁</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang TC", "Noto Sans TC", sans-serif;
         background: #F3EEE6; color: #2b2b2b; padding: 24px; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
  h1 { font-size: 20px; color: #2E6152; }
  .sub { color: #777; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
          gap: 16px; margin-top: 16px; }
  .card { background: #fff; border-radius: 12px; padding: 16px;
          box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .card h2 { font-size: 14px; color: #2E6152; margin-bottom: 10px; }
  .card h2 .tag { font-weight: normal; color: #999; font-size: 12px; }
  .status-pill { display: inline-block; padding: 6px 14px; border-radius: 999px;
                 font-size: 15px; font-weight: 600; }
  .st-stable { background: #E3EFE9; color: #2E6152; }
  .st-insufficient_data { background: #EEE; color: #777; }
  .st-worth_attention { background: #FBEEDD; color: #A96A1C; }
  .summary { margin-top: 10px; font-size: 15px; line-height: 1.6; }
  .muted { color: #999; font-size: 12px; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #f0ece4; }
  th { color: #999; font-weight: normal; font-size: 12px; }
  .bar-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 13px; }
  .bar-label { width: 3.5em; }
  .bar-track { flex: 1; height: 10px; background: #f0ece4; border-radius: 5px; position: relative; }
  .bar-base { position: absolute; height: 100%; background: #cfe0d8; border-radius: 5px; }
  .bar-recent { position: absolute; height: 4px; top: 3px; background: #2E6152; border-radius: 2px; }
  .bar-num { width: 7em; text-align: right; color: #777; font-size: 12px; }
  button { background: #2E6152; color: #fff; border: 0; border-radius: 8px;
           padding: 8px 14px; font-size: 13px; cursor: pointer; }
  button.ghost { background: #fff; color: #2E6152; border: 1px solid #2E6152; }
  button:disabled { opacity: .5; cursor: wait; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  input[type=text] { flex: 1; min-width: 200px; padding: 9px 12px; border: 1px solid #ddd;
           border-radius: 8px; font-size: 14px; }
  .chat-log { margin-top: 10px; display: flex; flex-direction: column; gap: 8px;
              max-height: 260px; overflow-y: auto; }
  .bubble { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 14px;
            line-height: 1.5; }
  .bubble.elder { align-self: flex-end; background: #E3EFE9; }
  .bubble.ai { align-self: flex-start; background: #f4f2ec; }
  .bubble .meta { font-size: 11px; color: #999; margin-top: 4px; }
  .warn { background: #FDEBE8; color: #A33C2C; padding: 8px 12px; border-radius: 8px;
          font-size: 13px; margin-top: 8px; }
  .notice { font-size: 12px; color: #999; margin-top: 12px; line-height: 1.6; }
  .lvl { font-weight: 700; padding: 1px 7px; border-radius: 4px; font-size: 12px; }
  .lvl-P2 { background: #FBEEDD; color: #A96A1C; }
  .lvl-P3 { background: #FDEBE8; color: #A33C2C; }
  .ok { color: #2E6152; } .no { color: #A33C2C; }
  #toast { position: fixed; bottom: 20px; right: 20px; background: #2E6152; color: #fff;
           padding: 10px 16px; border-radius: 8px; font-size: 13px; display: none; }
</style>
</head>
<body>
<header>
  <h1>安好 AI 自主生活守護 · 開發檢視頁</h1>
  <span class="sub">後端 :3000 · Fake adapters · 非正式前端</span>
</header>
<div class="sub">左側是守護者（陳怡君）看到的東西；右側是長者對話與系統內部。所有資料都經過與正式 API 相同的授權過濾。</div>

<div class="grid">

  <div class="card">
    <h2>G-01 最近好嗎 <span class="tag">守護者首頁</span></h2>
    <div id="status"></div>
    <h2 style="margin-top:16px">情境切換 <span class="tag">重灌 28 天模擬訊號並重跑排程</span></h2>
    <div class="row">
      <button onclick="scenario('worth_attention')">值得關心</button>
      <button class="ghost" onclick="scenario('stable')">穩定</button>
      <button class="ghost" onclick="scenario('insufficient')">資料不足</button>
    </div>
    <div class="notice">「資料不足」情境的數據其實明顯偏離 —— 但有效生活日只有 20 天，
    所以只寫內部記錄、不通知家人（交接規格 §4、§6）。</div>
  </div>

  <div class="card">
    <h2>E-02 跟我說 <span class="tag">扮演陳美玲</span></h2>
    <div class="row">
      <input type="text" id="utterance" placeholder="想跟我說什麼都可以…"
             onkeydown="if(event.key==='Enter')chat()">
      <button onclick="chat()">送出</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="ghost" onclick="say('今天早上我去市場買菜')">去市場</button>
      <button class="ghost" onclick="say('昨晚睡不太好')">睡不好</button>
      <button class="ghost" onclick="say('我剛剛在浴室滑了一下')">⚠ 高風險</button>
    </div>
    <div class="chat-log" id="chatlog"></div>
  </div>

  <div class="card">
    <h2>G-03 變化詳情 <span class="tag">為什麼這樣判斷</span></h2>
    <div id="alert"></div>
  </div>

  <div class="card">
    <h2>G-02 本週摘要</h2>
    <div id="digest"></div>
    <h2 style="margin-top:16px">授權 <span class="tag">G-05 我可以看到什麼</span></h2>
    <div id="scopes"></div>
    <div class="row" style="margin-top:8px">
      <button class="ghost" id="rawChatBtn" onclick="toggleRawChat()"></button>
    </div>
    <div class="notice">開啟 raw_chat_share 後，重新整理 G-03 才會附上訊號原句 ——
    這個切換只有「長者本人」做得到；此按鈕是以長者身分送出的。</div>
  </div>

  <div class="card">
    <h2>通知紀錄 <span class="tag">含被抑制者</span></h2>
    <div id="notifications"></div>
  </div>

  <div class="card">
    <h2>AI 萃取檢視 <span class="tag">長者實際畫面不會看到這些</span></h2>
    <div id="signals"></div>
    <div id="quality" class="notice"></div>
  </div>

</div>
<div id="toast"></div>

<script>
const EL = { Authorization: 'Bearer id-token:U-dev-elder-meiling', 'Content-Type': 'application/json' };
const GU = { Authorization: 'Bearer id-token:U-dev-guardian-yijun' };
let state = null;

const STATUS_LABEL = { stable: '穩定', insufficient_data: '資料不足', worth_attention: '值得關心' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function load() {
  const res = await fetch('/dev/api/state');
  state = await res.json();
  if (!state.seeded) { document.body.innerHTML = '<p style="padding:40px">' + esc(state.hint) + '</p>'; return; }
  renderStatus(); renderAlert(); renderDigest(); renderScopes(); renderNotifications(); renderSignals();
}

function renderStatus() {
  const s = state.status;
  document.getElementById('status').innerHTML =
    '<span class="status-pill st-' + s.status + '">' + STATUS_LABEL[s.status] + '</span>' +
    '<div class="summary">' + esc(s.summary) + '</div>' +
    '<div class="muted">更新於 ' + new Date(s.updatedAt).toLocaleString('zh-TW') + '</div>' +
    (s.recentEvents.length ? '<table style="margin-top:8px"><tr><th>時間</th><th>事件</th><th></th></tr>' +
      s.recentEvents.map(e => '<tr><td>' + e.when + '</td><td>' + esc(e.text) + '</td><td>' + esc(e.tag) + '</td></tr>').join('') +
      '</table>' : '');
}

function renderAlert() {
  const a = state.alertDetail;
  const el = document.getElementById('alert');
  if (!a) { el.innerHTML = '<div class="muted">目前沒有 alert。切到「值得關心」情境試試。</div>'; return; }
  el.innerHTML =
    '<span class="lvl lvl-' + a.level + '">' + a.level + '</span> ' +
    '<strong>' + esc(a.headline) + '</strong>' +
    (a.internalOnly ? '<div class="warn">internal_only：資料不足，只寫內部記錄，家人沒有收到通知</div>' : '') +
    '<div class="summary" style="font-size:13px">' + esc(a.explanation) + '</div>' +
    '<div class="muted">' + esc(a.versions.rule) + ' · ' + esc(a.versions.model) + ' · ' + esc(a.versions.prompt) +
    ' · snapshot ' + (a.baselineSnapshotId ? a.baselineSnapshotId.slice(0, 8) : '—') + '</div>' +
    '<table style="margin-top:8px"><tr><th>維度</th><th>日期</th><th>信心</th><th>原句</th></tr>' +
    a.supportingSignals.slice(0, 6).map(s =>
      '<tr><td>' + esc(s.dimension) + '</td><td>' + s.occurredOn + '</td><td>' + s.confidence + '</td><td>' +
      (s.quote ? esc(s.quote) : '<span class="muted">未授權</span>') + '</td></tr>').join('') +
    '</table>';
}

function renderDigest() {
  const d = state.digest;
  const el = document.getElementById('digest');
  if (!d) { el.innerHTML = '<div class="muted">尚未產生。可執行 npm run job -- digest_build</div>'; return; }
  const max = Math.max(...d.dimensionSummary.map(x => Math.max(x.recent, x.baseline)), 1);
  const LABEL = { interaction: '互動', outing: '外出', meal: '飲食', social: '社交' };
  el.innerHTML =
    '<strong>' + esc(d.headline) + '</strong>' +
    '<div class="summary" style="font-size:13px">' + esc(d.body) + '</div>' +
    d.dimensionSummary.map(x =>
      '<div class="bar-row"><span class="bar-label">' + (LABEL[x.dimension] ?? x.dimension) + '</span>' +
      '<span class="bar-track">' +
      '<span class="bar-base" style="width:' + (x.baseline / max * 100) + '%"></span>' +
      '<span class="bar-recent" style="width:' + (x.recent / max * 100) + '%"></span></span>' +
      '<span class="bar-num">' + x.recent + ' / 平常 ' + x.baseline + '</span></div>').join('') +
    '<div class="muted">深色為本週，淺色為個人平常水準（' + d.weekStart + ' 起）</div>';
}

function renderScopes() {
  document.getElementById('scopes').innerHTML = state.grantedScopes.map(s =>
    '<span class="lvl" style="background:#E3EFE9;color:#2E6152;margin-right:6px">' + esc(s) + '</span>').join('') || '<span class="muted">無</span>';
  const on = state.grantedScopes.includes('raw_chat_share');
  document.getElementById('rawChatBtn').textContent = on ? '關閉 raw_chat_share（長者身分）' : '開啟 raw_chat_share（長者身分）';
}

function renderNotifications() {
  document.getElementById('notifications').innerHTML =
    '<table><tr><th>種類</th><th>送出</th><th>抑制原因</th><th>時間</th></tr>' +
    state.notifications.map(n =>
      '<tr><td>' + esc(n.kind) + '</td>' +
      '<td class="' + (n.sentAt ? 'ok' : 'no') + '">' + (n.sentAt ? '✓' : '✗') + '</td>' +
      '<td>' + esc(n.suppressedReason ?? '—') + '</td>' +
      '<td>' + new Date(n.createdAt).toLocaleString('zh-TW') + '</td></tr>').join('') +
    '</table>' + (state.notifications.length ? '' : '<div class="muted">尚無通知</div>');
}

function renderSignals() {
  document.getElementById('signals').innerHTML =
    '<table><tr><th>維度</th><th>值</th><th>信心</th><th>日期</th><th>狀態</th></tr>' +
    state.recentSignals.map(s =>
      '<tr><td>' + esc(s.dimension) + '</td><td>' + esc(s.value) + '</td><td>' + s.confidence +
      '</td><td>' + s.occurredOn + '</td><td>' + esc(s.reviewState) + '</td></tr>').join('') + '</table>';
  const q = state.quality;
  document.getElementById('quality').textContent =
    'Signal Precision：已抽查 ' + q.reviewed + ' 筆，precision ' + q.precision + '（目標 0.85）· 待抽查 ' + state.reviewQueue.length + ' 筆';
}

function say(text) { document.getElementById('utterance').value = text; chat(); }

async function chat() {
  const input = document.getElementById('utterance');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addBubble('elder', text);
  const res = await fetch('/v1/chat/turn', { method: 'POST', headers: EL, body: JSON.stringify({ utterance: text }) });
  const data = await res.json();
  addBubble('ai', data.reply,
    '萃取 ' + data.signalCount + ' 個訊號' +
    (data.safetyHits?.length ? ' · ⚠ 命中安全規則（已即時通知守護者）' : ''));
  await load();
}

function addBubble(who, text, meta) {
  const log = document.getElementById('chatlog');
  const div = document.createElement('div');
  div.className = 'bubble ' + who;
  div.innerHTML = esc(text) + (meta ? '<div class="meta">' + esc(meta) + '</div>' : '');
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function toggleRawChat() {
  const on = state.grantedScopes.includes('raw_chat_share');
  await fetch('/v1/consent', { method: 'POST', headers: EL,
    body: JSON.stringify({ scope: 'raw_chat_share', granted: !on, evidenceRef: 'dev-console' }) });
  toast(on ? '已關閉 raw_chat_share' : '已開啟 raw_chat_share');
  await load();
}

async function scenario(name) {
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  toast('重灌情境資料並重跑排程…');
  const res = await fetch('/dev/api/scenario/' + name, { method: 'POST' });
  const data = await res.json();
  toast('完成：' + data.seeded.totalSignals + ' 筆訊號，有效生活日 ' + data.seeded.effectiveDays + ' 天');
  document.querySelectorAll('button').forEach(b => b.disabled = false);
  await load();
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', 4000);
}

load();
</script>
</body>
</html>`;
