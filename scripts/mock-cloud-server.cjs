const http = require('node:http');

const PORT = 3099;
let count = 0;

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/health') {
    console.log(`\n[health check] ${new Date().toLocaleTimeString()}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/envelope/push') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const { envelopes } = JSON.parse(body);
      const n = envelopes?.length ?? 0;
      count++;
      console.log(`\n=== batch #${count} [${new Date().toLocaleTimeString()}] ${n} envelopes ===`);
      if (envelopes) {
        for (const env of envelopes) {
          console.log(`  seq: ${env.seq}  role: ${env.role}  type: ${env.ev?.t}  sid: ${(env.sessionId || '').slice(0, 8)}`);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pushed: n, stored: n }));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/sessions/sync') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const { sessions } = JSON.parse(body);
      console.log(`\n[sync] ${new Date().toLocaleTimeString()} ${(sessions || []).length} sessions`);
      if (sessions) {
        for (const s of sessions) {
          console.log(`  sid: ${s.session_id.slice(0, 8)}  project: ${s.project_name}  title: ${s.title || '-'}`);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ synced: (sessions || []).length }));
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`mock cloud server listening on http://localhost:${PORT}`);
  console.log(`  POST /api/health`);
  console.log(`  POST /api/envelope/push`);
  console.log(`  POST /api/sessions/sync\n`);
});
