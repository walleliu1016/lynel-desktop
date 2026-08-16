/**
 * Host-half route smoke test (no DSH boot needed):
 * mounts the plugin's webServer handlers on a plain node:http server via a
 * mock ctx, then exercises bot.json + the ask/envelope proxy.
 *
 * Run:  node tests/host-routes.test.mjs
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../lib/index.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

// ── mock lynel backend ────────────────────────────────────────────────────
const envelopes = [];
const askServer = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    if (req.url.endsWith('/ask')) {
      const answers = (body.questions ?? []).map((q) => ({ id: q.id, selected: q.options?.[0] ? [q.options[0].label] : [] }));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ answers }));
    }
    if (req.url.endsWith('/envelope')) {
      envelopes.push(body);
      res.writeHead(202, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(404);
    res.end('{}');
  });
});
await new Promise((resolve) => askServer.listen(0, '127.0.0.1', resolve));
const askPort = askServer.address().port;

// ── temp bot.json + plugin ctx ────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'lynel-test-'));
const botFile = join(dir, 'bot.json');
writeFileSync(botFile, JSON.stringify({
  bots: [{ id: 'bot-a', name: 'Bot A', type: 'wecom' }],
  sessions: {},
}));

const routes = [];
let serverPort = 0; // assigned once the http server listens (plugin reads ctx.webServer.port at request time)
const mockCtx = {
  webServer: {
    get port() {
      return serverPort;
    },
    register(route) {
      routes.push(route);
      return () => {
        const i = routes.indexOf(route);
        if (i >= 0) routes.splice(i, 1);
      };
    },
  },
  effect(setup) {
    const disposer = setup();
    if (typeof disposer === 'function') mockCtx._dispose = disposer;
  },
};

apply(mockCtx, {
  botFile,
  askEndpoint: `http://127.0.0.1:${askPort}/deepseek-harness/ask`,
  envelopeEndpoint: `http://127.0.0.1:${askPort}/deepseek-harness/envelope`,
  askTimeoutMs: 5000,
});

// ── real http server over the registered routes ───────────────────────────
const gatewayCalls = [];
const server = createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  // fake the deployment's own /api gateway (what /lynel/send forwards to)
  if (pathname === '/api/session.prompt' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const envelope = JSON.parse(raw);
      gatewayCalls.push(envelope);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (envelope.payload.sessionId === 'ghost-session') {
        res.end(JSON.stringify({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: { ok: false, error: { code: 'session-not-found', message: 'session not found', details: {} } },
        }));
        return;
      }
      res.end(JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { accepted: true } } }));
    });
    return;
  }
  const route = routes.find((r) =>
    r.kind === 'exact' ? r.path === pathname : pathname.startsWith(r.path),
  );
  if (!route) { res.writeHead(404); return res.end('no route'); }
  return Promise.resolve(route.handler(req, res));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
serverPort = port;
const base = `http://127.0.0.1:${port}`;

const get = (p) => fetch(base + p);
const post = (p, body) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ── assertions ────────────────────────────────────────────────────────────
const cfg = await (await get('/lynel/config')).json();
check('config exposes endpoints', cfg.envelopeEndpoint.includes('17527') === false && typeof cfg.askTimeoutMs === 'number', JSON.stringify(cfg));

const doc = await (await get('/lynel/bot.json')).json();
check('bot.json GET returns document', doc.bots[0].id === 'bot-a' && Object.keys(doc.sessions).length === 0);

const bound = await (await post('/lynel/bot.json', { action: 'bind', sessionId: 'sess-1', botId: 'bot-a' })).json();
check('bot.json bind mutation', bound.sessions['sess-1'] === 'bot-a');

const unbound = await (await post('/lynel/bot.json', { action: 'unbind', sessionId: 'sess-1' })).json();
check('bot.json unbind mutation', unbound.sessions['sess-1'] === undefined);

const added = await (await post('/lynel/bot.json', { action: 'add-bot', bot: { name: 'Bot B', type: 'telegram', webhook: 'https://x' } })).json();
const addedBot = added.bots.find((b) => b.name === 'Bot B');
check('add-bot appends (auto id)', addedBot !== undefined && typeof addedBot.id === 'string' && addedBot.webhook === 'https://x', JSON.stringify(addedBot));

const dupRes = await post('/lynel/bot.json', { action: 'add-bot', bot: { id: 'bot-a', name: 'Dup' } });
check('add-bot rejects duplicate id', dupRes.status === 400);

await post('/lynel/bot.json', { action: 'bind', sessionId: 'sess-b', botId: addedBot.id });
const unboundBot = await (await post('/lynel/bot.json', { action: 'unbind-bot', botId: addedBot.id })).json();
check('unbind-bot removes all bindings of the bot', unboundBot.sessions['sess-b'] === undefined && unboundBot.bots.some((b) => b.id === addedBot.id));
check('unbind-bot on unknown bot rejected', (await post('/lynel/bot.json', { action: 'unbind-bot', botId: 'nope' })).status === 400);
const removed = await (await post('/lynel/bot.json', { action: 'remove-bot', botId: addedBot.id })).json();
check('remove-bot deletes and unbinds sessions', removed.bots.find((b) => b.id === addedBot.id) === undefined && removed.sessions['sess-b'] === undefined);
check('bind to unknown bot rejected', (await post('/lynel/bot.json', { action: 'bind', sessionId: 'x', botId: 'nope' })).status === 400);
await post('/lynel/bot.json', { action: 'add-bot', bot: { id: 'bot-one', name: 'One' } });
await post('/lynel/bot.json', { action: 'bind', sessionId: 'sess-1', botId: 'bot-one' });
const rebindRes = await post('/lynel/bot.json', { action: 'bind', sessionId: 'sess-2', botId: 'bot-one' });
check('bind to a bot already bound elsewhere rejected', rebindRes.status === 400);
check('bind error names the owning session', JSON.stringify(await rebindRes.json()).includes('sess-1'));
// rebinding the SAME session to the same bot stays allowed (idempotent)
check('re-bind same session same bot allowed', (await post('/lynel/bot.json', { action: 'bind', sessionId: 'sess-1', botId: 'bot-one' })).status === 200);

const ask = await post('/lynel/proxy/ask', {
  sessionId: 'sess-1',
  questions: [{ id: 'q1', question: 'go?', options: [{ label: 'yes' }, { label: 'no' }] }],
});
const askBody = await ask.json();
check('ask proxy relays upstream answer', ask.status === 200 && askBody.answers?.[0]?.selected?.[0] === 'yes', JSON.stringify(askBody));

const env = await post('/lynel/proxy/envelope', { id: 'e1', seq: 1, role: 'agent', ev: { t: 'turn-start' } });
check('envelope proxy accepts', env.status === 202);
check('envelope reached upstream', envelopes.length === 1 && envelopes[0].id === 'e1');

const missing = await get('/lynel/bot.json?nope=1');
// delete the file first to check the 404 path
rmSync(botFile);
const missing404 = await get('/lynel/bot.json');
check('bot.json 404 after removal', missing404.status === 404);
check('unknown proxy target 404', (await post('/lynel/proxy/nope', {})).status === 404);

// ── /lynel/send (external message injection) ──────────────────────────────
const sent = await post('/lynel/send', { sessionId: 'sess-live', text: '你好，来自外部' });
check('/lynel/send accepts text', sent.status === 200 && (await sent.json()).ok === true);
check('/lynel/send forwards to session.prompt gateway', gatewayCalls.length === 1 && gatewayCalls[0].method === 'session.prompt' && gatewayCalls[0].payload.mode === 'queue');
check('/lynel/send payload carries the text', gatewayCalls[0].payload.content[0].text === '你好，来自外部');

const sentSteer = await post('/lynel/send', { sessionId: 'sess-live', mode: 'steer', content: [{ type: 'text', text: 'x' }] });
check('/lynel/send supports mode/content forms', sentSteer.status === 200 && gatewayCalls[1].payload.mode === 'steer' && gatewayCalls[1].payload.content[0].text === 'x');

const notFound = await post('/lynel/send', { sessionId: 'ghost-session', text: 'hi' });
check('/lynel/send relays session-not-found as 404', notFound.status === 404 && (await notFound.json()).error === 'session-not-found');

check('/lynel/send rejects missing text', (await post('/lynel/send', { sessionId: 's' })).status === 400);
check('/lynel/send rejects missing sessionId', (await post('/lynel/send', { text: 'hi' })).status === 400);
check('/lynel/send rejects non-POST', (await get('/lynel/send')).status === 405);

mockCtx._dispose?.();
check('disposer removes routes', routes.length === 0);

server.close();
askServer.close();
rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
