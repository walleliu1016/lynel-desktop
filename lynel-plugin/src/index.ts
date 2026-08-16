/**
 * lynel-plugin — host half (Node / cordis plugin).
 *
 * Bridges the DSH web frontend and the Lynel Desktop backend:
 *
 *  - `~/.lynel-desktop/bot.json` — bot registry + session↔bot bindings.
 *    Exposed to the browser through same-origin routes (no CORS needed):
 *      GET  /lynel/bot.json            → the whole document (404 when missing)
 *      POST /lynel/bot.json            → replace the document, or
 *                                        {action:'bind'|'unbind', sessionId, botId?}
 *      GET  /lynel/config              → effective plugin config
 *  - HTTP forwarding to the Lynel backend (the browser cannot reach
 *    `localhost:17527` cross-origin, so the host proxies instead):
 *      POST /lynel/proxy/ask      → config.askEndpoint
 *      POST /lynel/proxy/envelope → config.envelopeEndpoint
 *
 * The proxy protocol is defined in the plugin README; the host is a thin
 * transparent forwarder (status + JSON body relayed verbatim).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';

/** Stable cordis plugin name. */
export const name = 'lynel-plugin';

/** Host services required before this plugin mounts. */
export const inject = ['webServer'];

/** Plugin config; every field has a code default (override via the profile patch row's `config:`). */
export interface Config {
  /** Bot registry document path. Defaults to `~/.lynel-desktop/bot.json`. */
  botFile: string;
  /** Lynel ask-hook endpoint (forwarded from `/lynel/proxy/ask`). */
  askEndpoint: string;
  /** Lynel envelope sink (forwarded from `/lynel/proxy/envelope`). */
  envelopeEndpoint: string;
  /** Ask-hook upstream timeout in ms; 504 when exceeded. */
  askTimeoutMs: number;
  /** Envelope upstream timeout in ms. */
  envelopeTimeoutMs: number;
  /** Response body byte cap for proxied upstreams (defensive). */
  maxBodyBytes: number;
}

const DEFAULTS: Config = {
  botFile: join(homedir(), '.lynel-desktop', 'bot.json'),
  askEndpoint: 'http://localhost:17527/deepseek-harness/ask',
  envelopeEndpoint: 'http://localhost:17527/deepseek-harness/envelope',
  askTimeoutMs: 120_000,
  envelopeTimeoutMs: 10_000,
  maxBodyBytes: 1 << 20,
};

/** bot.json document shape (shared with the client via GET /lynel/bot.json). */
export interface LynelBotDoc {
  /** Registered bots; each entry is opaque to this plugin. */
  bots: Array<Record<string, unknown>>;
  /** sessionId → botId binding table. */
  sessions: Record<string, string>;
}

/* ── bot.json IO ─────────────────────────────────────────────────────────── */

function readBotDoc(file: string): LynelBotDoc | null {
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LynelBotDoc>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return {
      bots: Array.isArray(parsed.bots) ? parsed.bots : [],
      sessions: typeof parsed.sessions === 'object' && parsed.sessions !== null ? parsed.sessions : {},
    };
  } catch {
    return null;
  }
}

function writeBotDoc(file: string, doc: LynelBotDoc): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');
}

/** Apply a bot-document mutation (POST /lynel/bot.json with an `action`). */
function applyMutation(doc: LynelBotDoc, body: Record<string, unknown>): LynelBotDoc {
  const action = body.action;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (action === 'bind' || action === 'unbind') {
    if (sessionId === '') throw new Error('mutation requires a string sessionId');
    const next: LynelBotDoc = { bots: doc.bots, sessions: { ...doc.sessions } };
    if (action === 'bind') {
      const botId = typeof body.botId === 'string' ? body.botId : '';
      if (botId === '') throw new Error('bind requires a string botId');
      if (!next.bots.some((bot) => String(bot['id']) === botId)) {
        throw new Error(`unknown bot id "${botId}"`);
      }
      // one bot per session: reject when already bound to a different session
      const otherOwner = Object.entries(next.sessions).find(([sid, bid]) => bid === botId && sid !== sessionId);
      if (otherOwner !== undefined) {
        throw new Error(`bot "${botId}" is already bound to session ${otherOwner[0]}; unbind it there first`);
      }
      next.sessions[sessionId] = botId;
    } else {
      delete next.sessions[sessionId];
    }
    return next;
  }
  if (action === 'add-bot') {
    const bot = body.bot;
    if (typeof bot !== 'object' || bot === null || Array.isArray(bot)) {
      throw new Error('add-bot requires a bot object');
    }
    const record = bot as Record<string, unknown>;
    const id = typeof record['id'] === 'string' && record['id'] !== '' ? record['id'] : `bot-${Date.now().toString(36)}`;
    if (doc.bots.some((existing) => String(existing['id']) === id)) {
      throw new Error(`bot id "${id}" already exists`);
    }
    return { bots: [...doc.bots, { ...record, id }], sessions: doc.sessions };
  }
  if (action === 'unbind-bot') {
    const botId = typeof body.botId === 'string' ? body.botId : '';
    if (botId === '') throw new Error('unbind-bot requires a string botId');
    if (!doc.bots.some((bot) => String(bot['id']) === botId)) {
      throw new Error(`unknown bot id "${botId}"`);
    }
    const sessions: Record<string, string> = {};
    for (const [sid, bid] of Object.entries(doc.sessions)) {
      if (bid !== botId) sessions[sid] = bid;
    }
    return { bots: doc.bots, sessions };
  }
  if (action === 'remove-bot') {
    const botId = typeof body.botId === 'string' ? body.botId : '';
    if (botId === '') throw new Error('remove-bot requires a string botId');
    const sessions: Record<string, string> = {};
    for (const [sid, bid] of Object.entries(doc.sessions)) {
      if (bid !== botId) sessions[sid] = bid;
    }
    return { bots: doc.bots.filter((bot) => String(bot['id']) !== botId), sessions };
  }
  throw new Error(`unknown action "${String(action)}" (bind | unbind | add-bot | remove-bot | unbind-bot)`);
}

/* ── tiny request helpers ────────────────────────────────────────────────── */

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Forward one proxied POST; relay the upstream status + JSON body verbatim. */
async function forwardPost(url: string, body: string, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body,
      signal: controller.signal,
    });
    const text = await upstream.text();
    let parsed: unknown = text;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      /* relay non-JSON upstream bodies as raw strings */
    }
    return { status: upstream.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Push a user message into a DSH session by calling the deployment's own API
 * gateway (`/api/session.prompt`) over the loopback webserver. This reuses the
 * full host prompt pipeline (agent resolution, cold-session resume, preset
 * composition, model checks) instead of reimplementing it.
 * @param port - the webserver listen port (ctx.webServer.port).
 * @param payload - the session.prompt request payload.
 * @returns the relayed gateway result.
 */
async function forwardPrompt(
  port: number,
  payload: { sessionId: string; mode: 'queue' | 'steer'; content: Array<{ type: 'text'; text: string }> },
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const envelope = {
    type: 'client-request',
    rpcId: crypto.randomUUID(),
    method: 'session.prompt',
    payload,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(`http://127.0.0.1:${port}/api/session.prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    let parsed: unknown = null;
    try {
      parsed = await upstream.json();
    } catch {
      /* non-JSON upstream */
    }
    if (upstream.ok && typeof parsed === 'object' && parsed !== null) {
      const result = (parsed as { result?: { ok?: boolean; error?: { code?: string; message?: string } } }).result;
      if (result?.ok === true) return { status: 200, body: { ok: true, accepted: true } };
      const code = result?.error?.code ?? 'internal';
      const message = result?.error?.message ?? 'prompt rejected';
      const status = code === 'session-not-found' ? 404 : code === 'agent-busy' || code === 'model-unavailable' ? 409 : 400;
      return { status, body: { ok: false, error: code, message } };
    }
    return { status: upstream.ok ? 502 : upstream.status, body: parsed ?? { ok: false, error: 'internal', message: `gateway HTTP ${upstream.status}` } };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { status: aborted ? 504 : 502, body: { ok: false, error: 'internal', message: error instanceof Error ? error.message : String(error) } };
  } finally {
    clearTimeout(timer);
  }
}

/* ── plugin body ─────────────────────────────────────────────────────────── */

/**
 * Mount the lynel bridge: bot.json routes plus the ask/envelope proxy.
 * @param ctx - host plugin context carrying the webServer service.
 * @param rawConfig - validated config from the profile patch row (optional).
 */
export function apply(ctx: Context, rawConfig: Partial<Config> = {}): void {
  const config: Config = { ...DEFAULTS, ...rawConfig };

  ctx.effect(() => {
    const disposers: Array<() => void> = [];

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/lynel/config',
      handler: (_req, res) => sendJson(res, 200, config),
    }));

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/lynel/bot.json',
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            const doc = readBotDoc(config.botFile);
            if (doc === null) return sendJson(res, 404, { error: 'bot.json not found', path: config.botFile });
            return sendJson(res, 200, doc);
          }
          if (req.method === 'POST') {
            const body = JSON.parse(await readBody(req, config.maxBodyBytes)) as Record<string, unknown>;
            if (typeof body !== 'object' || body === null) throw new Error('body must be a JSON object');
            const current = readBotDoc(config.botFile) ?? { bots: [], sessions: {} };
            const next = typeof body.action === 'string' ? applyMutation(current, body) : (body as unknown as LynelBotDoc);
            writeBotDoc(config.botFile, next);
            return sendJson(res, 200, next);
          }
          return sendJson(res, 405, { error: `method ${req.method ?? ''} not allowed` });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return sendJson(res, 400, { error: message });
        }
      },
    }));

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/lynel/send',
      handler: async (req, res) => {
        try {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST required' });
          const body = JSON.parse(await readBody(req, config.maxBodyBytes)) as Record<string, unknown>;
          if (typeof body !== 'object' || body === null) throw new Error('body must be a JSON object');
          const sessionId = typeof body['sessionId'] === 'string' ? body['sessionId'] : '';
          if (sessionId === '') throw new Error('sessionId is required');
          const mode = body['mode'] === 'steer' ? 'steer' : 'queue';
          const content = Array.isArray(body['content'])
            ? body['content']
            : typeof body['text'] === 'string' && body['text'] !== ''
              ? [{ type: 'text', text: body['text'] }]
              : null;
          if (content === null) throw new Error('text (or content) is required');
          const sanitized = content
            .filter((part): part is { type: 'text'; text: string } =>
              typeof part === 'object' && part !== null && part['type'] === 'text' && typeof part['text'] === 'string')
            .map((part) => ({ type: 'text' as const, text: part['text'] }));
          if (sanitized.length === 0) throw new Error('content must contain at least one text part');
          const outcome = await forwardPrompt(ctx.webServer.port, { sessionId, mode, content: sanitized }, config.askTimeoutMs);
          return sendJson(res, outcome.status, outcome.body);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return sendJson(res, 400, { ok: false, error: 'bad-request', message });
        }
      },
    }));

    disposers.push(ctx.webServer.register({
      kind: 'prefix',
      path: '/lynel/proxy',
      handler: async (req, res) => {
        const pathname = req.url?.split('?')[0] ?? '';
        try {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST required' });
          const body = await readBody(req, config.maxBodyBytes);
          let endpoint: string | undefined;
          if (pathname.endsWith('/proxy/ask')) endpoint = config.askEndpoint;
          else if (pathname.endsWith('/proxy/envelope')) endpoint = config.envelopeEndpoint;
          if (endpoint === undefined) return sendJson(res, 404, { error: `unknown proxy target ${pathname}` });
          const timeout = pathname.endsWith('/proxy/ask') ? config.askTimeoutMs : config.envelopeTimeoutMs;
          const upstream = await forwardPost(endpoint, body, timeout);
          return sendJson(res, upstream.status, upstream.body);
        } catch (error) {
          const aborted = error instanceof Error && error.name === 'AbortError';
          return sendJson(res, aborted ? 504 : 502, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }));

    return () => {
      for (const dispose of disposers) dispose();
    };
  }, 'lynel-plugin: web routes');
}
