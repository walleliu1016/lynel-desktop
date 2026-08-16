/**
 * dsh-lynel-plugin — mock Lynel backend for local end-to-end testing.
 *
 * Implements the two hook endpoints plus a browser envelope viewer:
 *
 *   POST   /deepseek-harness/ask              — echo a canned answer
 *   POST   /deepseek-harness/envelope         — append envelopes to the log
 *   GET    /deepseek-harness/envelopes        — last N envelopes as JSON
 *   DELETE /deepseek-harness/envelopes        — clear the log
 *   GET    /                                  — HTML viewer (polls every 1s)
 *
 * Usage:  node mock/lynel-server.mjs
 *   PORT=17528 node mock/lynel-server.mjs
 *   ENVELOPE_LOG=/path/to/log.jsonl node mock/lynel-server.mjs
 *   ASK_ANSWERS_JSON='[...]' node mock/lynel-server.mjs   # canned answers
 *   ASK_CANCEL=1 node mock/lynel-server.mjs               # reply {"cancelled":true}
 *   ASK_FAIL=1 node mock/lynel-server.mjs                 # reply HTTP 500
 */
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PORT = Number(process.env.PORT ?? 17527);
const ENVELOPE_LOG = process.env.ENVELOPE_LOG ?? join(homedir(), '.lynel-desktop', 'mock-envelopes.jsonl');
const MAX_RETURN = Number(process.env.MAX_RETURN ?? 200);
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...CORS, 'content-type': contentType });
  res.end(payload);
}

function readLog() {
  if (!existsSync(ENVELOPE_LOG)) return [];
  return readFileSync(ENVELOPE_LOG, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry !== null);
}

const VIEWER_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>LynelEnvelope 查看器</title>
<style>
  body { font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; background:#101114; color:#d6d8dc; margin:0; }
  header { position:sticky; top:0; background:#17181c; border-bottom:1px solid #2a2c32; padding:8px 14px;
           display:flex; align-items:center; gap:12px; z-index:10; }
  header b { font-size:14px; }
  header .meta { color:#8a8f98; font-size:12px; }
  button { background:#26282e; color:#d6d8dc; border:1px solid #3a3d45; border-radius:6px; padding:3px 10px; cursor:pointer; font-size:12px; }
  button:hover { background:#30333a; }
  .row { padding:6px 14px; border-bottom:1px solid #23252b; display:flex; gap:10px; align-items:baseline; }
  .row:hover { background:#1a1c22; }
  .seq { color:#5c7cfa; min-width:52px; }
  .time { color:#7a7f88; min-width:88px; font-size:11px; }
  .sess { color:#8a8f98; font-size:11px; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tag { font-weight:600; min-width:130px; }
  .t-text .tag { color:#4cc38a; } .t-tool .tag { color:#e3b341; } .t-turn .tag { color:#7aa2f7; }
  .t-user { color:#9aa4b2; } .t-agent { color:#d6d8dc; }
  .body { color:#9aa4b2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
  .role { font-size:10px; border:1px solid #3a3d45; border-radius:4px; padding:0 5px; color:#8a8f98; }
  #raw { white-space:pre-wrap; padding:12px 14px; display:none; font-size:11px; color:#b9bec7; }
  .empty { padding:40px; text-align:center; color:#5c6068; }
</style>
</head>
<body>
<header>
  <b>LynelEnvelope</b>
  <span class="meta" id="meta">连接中…</span>
  <button id="clear">清空</button>
  <button id="rawBtn">原始 JSON</button>
  <span class="meta">http://127.0.0.1:${PORT}</span>
</header>
<div id="list"></div>
<pre id="raw"></pre>
<script>
const listEl = document.getElementById('list');
const rawEl = document.getElementById('raw');
const metaEl = document.getElementById('meta');
const rawBtn = document.getElementById('rawBtn');
let rawMode = false;

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function shortText(ev) {
  if (ev.t === 'text') return ev.thinking ? '[thinking] ' + (ev.text||'').slice(0,80) : (ev.text||'').replace(/\\n/g,' ').slice(0,100);
  if (ev.t === 'service') return ev.text || '';
  if (ev.t === 'tool-call-start') return ev.name + ' ' + JSON.stringify(ev.args||{}).slice(0,80);
  if (ev.t === 'tool-call-end') return 'call=' + ev.call + (ev.is_error ? ' (error)' : '');
  if (ev.t === 'turn-end') return ev.status || '';
  if (ev.t === 'turn-start') return '';
  if (ev.t === 'start') return '会话订阅';
  return '';
}
function cls(ev) {
  if (ev.t === 'text') return 't-text';
  if (ev.t === 'tool-call-start' || ev.t === 'tool-call-end') return 't-tool';
  if (ev.t === 'turn-start' || ev.t === 'turn-end') return 't-turn';
  return '';
}
async function refresh() {
  try {
    const res = await fetch('/deepseek-harness/envelopes?limit=500');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const envs = await res.json();
    metaEl.textContent = '共 ' + envs.length + ' 条（每秒刷新）';
    const rows = envs.map((e) => {
      const time = new Date(e.time).toLocaleTimeString('zh-CN', { hour12: false });
      const tag = e.ev.t;
      const body = shortText(e.ev) || JSON.stringify(e.ev).slice(0,100);
      return '<div class="row ' + cls(e.ev) + '"><span class="seq">#' + e.seq + '</span>' +
        '<span class="time">' + time + '</span>' +
        '<span class="role">' + e.role + '</span>' +
        '<span class="tag">' + tag + '</span>' +
        '<span class="sess">' + esc(e.sessionId||'') + '</span>' +
        '<span class="body">' + esc(body) + '</span></div>';
    }).join('');
    listEl.innerHTML = rows || '<div class="empty">还没有收到 envelope — 去 DSH 里说句话或让 agent 调用工具</div>';
    rawEl.textContent = envs.map((e) => JSON.stringify(e)).join('\\n');
    if (!rawMode) rawEl.style.display = 'none'; else { rawEl.style.display = 'block'; listEl.style.display = 'none'; }
  } catch (err) {
    metaEl.textContent = '读取失败: ' + err.message;
  }
}
rawBtn.onclick = () => { rawMode = !rawMode; };
document.getElementById('clear').onclick = async () => {
  await fetch('/deepseek-harness/envelopes', { method: 'DELETE' });
  refresh();
};
refresh();
setInterval(refresh, 1000);
</script>
</body>
</html>`;

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const url = req.url ?? '';
  const pathname = url.split('?')[0];

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return send(res, 200, VIEWER_HTML, 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && pathname.endsWith('/deepseek-harness/envelopes')) {
    const limitParam = new URL(url, 'http://x').searchParams.get('limit');
    const limit = limitParam ? Math.min(Number(limitParam) || MAX_RETURN, 1000) : MAX_RETURN;
    return send(res, 200, readLog().slice(-limit));
  }

  if (req.method === 'DELETE' && pathname.endsWith('/deepseek-harness/envelopes')) {
    try {
      rmSync(ENVELOPE_LOG, { force: true });
      return send(res, 200, { ok: true, cleared: true });
    } catch (error) {
      return send(res, 500, { error: String(error) });
    }
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return send(res, 400, { error: 'bad json' });
    }

    if (pathname.endsWith('/deepseek-harness/ask')) {
      console.log(`[ask] session=${body.sessionId ?? '?'} questions=${JSON.stringify(body.questions?.map((q) => q.id))}`);
      if (process.env.ASK_FAIL === '1') return send(res, 500, { error: 'simulated failure' });
      if (process.env.ASK_CANCEL === '1') return send(res, 200, { cancelled: true });
      const answers =
        process.env.ASK_ANSWERS_JSON !== undefined
          ? JSON.parse(process.env.ASK_ANSWERS_JSON)
          : (body.questions ?? []).map((q) => ({
              id: q.id,
              selected: q.options?.[0] ? [q.options[0].label] : [],
              custom: undefined,
            }));
      return send(res, 200, { answers });
    }

    if (pathname.endsWith('/deepseek-harness/envelope')) {
      try {
        mkdirSync(join(ENVELOPE_LOG, '..'), { recursive: true });
        appendFileSync(ENVELOPE_LOG, JSON.stringify(body) + '\n', 'utf8');
      } catch (error) {
        return send(res, 500, { error: String(error) });
      }
      return send(res, 202, { ok: true });
    }

    return send(res, 404, { error: `unknown path ${url}` });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[lynel-mock] listening on http://127.0.0.1:${PORT}`);
  console.log(`[lynel-mock] envelope viewer → http://127.0.0.1:${PORT}/`);
  console.log(`[lynel-mock] envelopes → ${ENVELOPE_LOG}`);
});
