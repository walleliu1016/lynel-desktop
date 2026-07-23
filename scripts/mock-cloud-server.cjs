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

  if (req.method === 'POST' && req.url === '/desktop/connect') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      count++;
      const env = JSON.parse(body);
      console.log(`\n=== #${count} [${new Date().toLocaleTimeString()}] ===`);
      console.log(`  seq: ${env.seq}  role: ${env.role}  type: ${env.ev?.t}`);
      if (env.ev?.t === 'text') {
        const preview = (env.ev.text || '').slice(0, 120);
        console.log(`  text: ${preview}`);
      } else if (env.ev?.t === 'tool-call-start') {
        console.log(`  tool: ${env.ev.name}`);
      } else if (env.ev?.t === 'tool-call-end') {
        console.log(`  call: ${env.ev.call}  error: ${!!env.ev.is_error}`);
      }
      console.log(`  full: ${JSON.stringify(env)}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`mock cloud server listening on http://localhost:${PORT}`);
  console.log(`endpoint: POST http://localhost:${PORT}/desktop/connect\n`);
});
