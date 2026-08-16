/* lynel-plugin — built artifact, do not edit. */

// src/index.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
var name = "lynel-plugin";
var inject = ["webServer"];
var DEFAULTS = {
  botFile: join(homedir(), ".lynel-desktop", "bot.json"),
  askEndpoint: "http://localhost:17527/deepseek-harness/ask",
  envelopeEndpoint: "http://localhost:17527/deepseek-harness/envelope",
  askTimeoutMs: 12e4,
  envelopeTimeoutMs: 1e4,
  maxBodyBytes: 1 << 20
};
function readBotDoc(file) {
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      bots: Array.isArray(parsed.bots) ? parsed.bots : [],
      sessions: typeof parsed.sessions === "object" && parsed.sessions !== null ? parsed.sessions : {}
    };
  } catch {
    return null;
  }
}
function writeBotDoc(file, doc) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2), "utf8");
}
function applyMutation(doc, body) {
  const action = body.action;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (action === "bind" || action === "unbind") {
    if (sessionId === "") throw new Error("mutation requires a string sessionId");
    const next = { bots: doc.bots, sessions: { ...doc.sessions } };
    if (action === "bind") {
      const botId = typeof body.botId === "string" ? body.botId : "";
      if (botId === "") throw new Error("bind requires a string botId");
      if (!next.bots.some((bot) => String(bot["id"]) === botId)) {
        throw new Error(`unknown bot id "${botId}"`);
      }
      const otherOwner = Object.entries(next.sessions).find(([sid, bid]) => bid === botId && sid !== sessionId);
      if (otherOwner !== void 0) {
        throw new Error(`bot "${botId}" is already bound to session ${otherOwner[0]}; unbind it there first`);
      }
      next.sessions[sessionId] = botId;
    } else {
      delete next.sessions[sessionId];
    }
    return next;
  }
  if (action === "add-bot") {
    const bot = body.bot;
    if (typeof bot !== "object" || bot === null || Array.isArray(bot)) {
      throw new Error("add-bot requires a bot object");
    }
    const record = bot;
    const id = typeof record["id"] === "string" && record["id"] !== "" ? record["id"] : `bot-${Date.now().toString(36)}`;
    if (doc.bots.some((existing) => String(existing["id"]) === id)) {
      throw new Error(`bot id "${id}" already exists`);
    }
    return { bots: [...doc.bots, { ...record, id }], sessions: doc.sessions };
  }
  if (action === "unbind-bot") {
    const botId = typeof body.botId === "string" ? body.botId : "";
    if (botId === "") throw new Error("unbind-bot requires a string botId");
    if (!doc.bots.some((bot) => String(bot["id"]) === botId)) {
      throw new Error(`unknown bot id "${botId}"`);
    }
    const sessions = {};
    for (const [sid, bid] of Object.entries(doc.sessions)) {
      if (bid !== botId) sessions[sid] = bid;
    }
    return { bots: doc.bots, sessions };
  }
  if (action === "remove-bot") {
    const botId = typeof body.botId === "string" ? body.botId : "";
    if (botId === "") throw new Error("remove-bot requires a string botId");
    const sessions = {};
    for (const [sid, bid] of Object.entries(doc.sessions)) {
      if (bid !== botId) sessions[sid] = bid;
    }
    return { bots: doc.bots.filter((bot) => String(bot["id"]) !== botId), sessions };
  }
  throw new Error(`unknown action "${String(action)}" (bind | unbind | add-bot | remove-bot | unbind-bot)`);
}
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}
async function forwardPost(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body,
      signal: controller.signal
    });
    const text = await upstream.text();
    let parsed = text;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
    }
    return { status: upstream.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}
async function forwardPrompt(port, payload, timeoutMs) {
  const envelope = {
    type: "client-request",
    rpcId: crypto.randomUUID(),
    method: "session.prompt",
    payload
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(`http://127.0.0.1:${port}/api/session.prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
      signal: controller.signal
    });
    let parsed = null;
    try {
      parsed = await upstream.json();
    } catch {
    }
    if (upstream.ok && typeof parsed === "object" && parsed !== null) {
      const result = parsed.result;
      if (result?.ok === true) return { status: 200, body: { ok: true, accepted: true } };
      const code = result?.error?.code ?? "internal";
      const message = result?.error?.message ?? "prompt rejected";
      const status = code === "session-not-found" ? 404 : code === "agent-busy" || code === "model-unavailable" ? 409 : 400;
      return { status, body: { ok: false, error: code, message } };
    }
    return { status: upstream.ok ? 502 : upstream.status, body: parsed ?? { ok: false, error: "internal", message: `gateway HTTP ${upstream.status}` } };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { status: aborted ? 504 : 502, body: { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) } };
  } finally {
    clearTimeout(timer);
  }
}
function apply(ctx, rawConfig = {}) {
  const config = { ...DEFAULTS, ...rawConfig };
  ctx.effect(() => {
    const disposers = [];
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/lynel/config",
      handler: (_req, res) => sendJson(res, 200, config)
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/lynel/bot.json",
      handler: async (req, res) => {
        try {
          if (req.method === "GET") {
            const doc = readBotDoc(config.botFile);
            if (doc === null) return sendJson(res, 404, { error: "bot.json not found", path: config.botFile });
            return sendJson(res, 200, doc);
          }
          if (req.method === "POST") {
            const body = JSON.parse(await readBody(req, config.maxBodyBytes));
            if (typeof body !== "object" || body === null) throw new Error("body must be a JSON object");
            const current = readBotDoc(config.botFile) ?? { bots: [], sessions: {} };
            const next = typeof body.action === "string" ? applyMutation(current, body) : body;
            writeBotDoc(config.botFile, next);
            return sendJson(res, 200, next);
          }
          return sendJson(res, 405, { error: `method ${req.method ?? ""} not allowed` });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return sendJson(res, 400, { error: message });
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/lynel/send",
      handler: async (req, res) => {
        try {
          if (req.method !== "POST") return sendJson(res, 405, { error: "POST required" });
          const body = JSON.parse(await readBody(req, config.maxBodyBytes));
          if (typeof body !== "object" || body === null) throw new Error("body must be a JSON object");
          const sessionId = typeof body["sessionId"] === "string" ? body["sessionId"] : "";
          if (sessionId === "") throw new Error("sessionId is required");
          const mode = body["mode"] === "steer" ? "steer" : "queue";
          const content = Array.isArray(body["content"]) ? body["content"] : typeof body["text"] === "string" && body["text"] !== "" ? [{ type: "text", text: body["text"] }] : null;
          if (content === null) throw new Error("text (or content) is required");
          const sanitized = content.filter((part) => typeof part === "object" && part !== null && part["type"] === "text" && typeof part["text"] === "string").map((part) => ({ type: "text", text: part["text"] }));
          if (sanitized.length === 0) throw new Error("content must contain at least one text part");
          const outcome = await forwardPrompt(ctx.webServer.port, { sessionId, mode, content: sanitized }, config.askTimeoutMs);
          return sendJson(res, outcome.status, outcome.body);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return sendJson(res, 400, { ok: false, error: "bad-request", message });
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "prefix",
      path: "/lynel/proxy",
      handler: async (req, res) => {
        const pathname = req.url?.split("?")[0] ?? "";
        try {
          if (req.method !== "POST") return sendJson(res, 405, { error: "POST required" });
          const body = await readBody(req, config.maxBodyBytes);
          let endpoint;
          if (pathname.endsWith("/proxy/ask")) endpoint = config.askEndpoint;
          else if (pathname.endsWith("/proxy/envelope")) endpoint = config.envelopeEndpoint;
          if (endpoint === void 0) return sendJson(res, 404, { error: `unknown proxy target ${pathname}` });
          const timeout = pathname.endsWith("/proxy/ask") ? config.askTimeoutMs : config.envelopeTimeoutMs;
          const upstream = await forwardPost(endpoint, body, timeout);
          return sendJson(res, upstream.status, upstream.body);
        } catch (error) {
          const aborted = error instanceof Error && error.name === "AbortError";
          return sendJson(res, aborted ? 504 : 502, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }));
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "lynel-plugin: web routes");
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
