/* lynel-plugin — built artifact, do not edit. */
window.__ModuleLoader__.load({
	id: "lynel-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/client/envelope.ts
function readTurn(data) {
  const turn = data["turn"];
  return typeof turn === "number" ? String(turn) : typeof turn === "string" ? turn : void 0;
}
function contentToText(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const record = block;
    if (record["type"] === "text" && typeof record["text"] === "string") parts.push(record["text"]);
  }
  return parts.join("");
}
function toUsage(usage) {
  if (typeof usage !== "object" || usage === null) return void 0;
  const record = usage;
  const input = record["inputTokens"];
  const output = record["outputTokens"];
  if (typeof input !== "number" && typeof output !== "number") return void 0;
  const result = {
    input_tokens: typeof input === "number" ? input : 0,
    output_tokens: typeof output === "number" ? output : 0
  };
  if (typeof record["cacheReadTokens"] === "number") result.cache_read_input_tokens = record["cacheReadTokens"];
  if (typeof record["cacheWriteTokens"] === "number") result.cache_creation_input_tokens = record["cacheWriteTokens"];
  return result;
}
function turnEndStatus(reason) {
  if (typeof reason === "object" && reason !== null) {
    const kind = reason["kind"];
    if (kind === "error" || kind === "interrupted") return "failed";
    if (kind === "aborted" || kind === "blocked") return "cancelled";
  }
  return "completed";
}
function uuid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function toEnvelope(sessionId, event, seq, options = {}) {
  const base = {
    id: uuid(),
    time: event.time,
    seq,
    sessionId,
    turn: readTurn(event.data),
    agent: options.agent ?? "dsh"
  };
  const data = event.data;
  switch (event.type) {
    case "turn/start":
      return { ...base, role: "agent", ev: { t: "turn-start" } };
    case "turn/end":
      return { ...base, role: "agent", ev: { t: "turn-end", status: turnEndStatus(data["reason"]) } };
    case "user/message":
      return { ...base, role: "user", ev: { t: "text", text: contentToText(data["content"]) } };
    case "assistant/message":
      return {
        ...base,
        role: "agent",
        ev: { t: "text", text: contentToText(data["message"]?.["content"]) },
        usage: toUsage(data["usage"])
      };
    case "assistant/chunk":
      if (!options.includeChunks) return null;
      {
        const chunk = data["chunk"];
        const delta = chunk?.["delta"];
        const text = typeof delta === "string" ? delta : delta?.["text"];
        return { ...base, role: "agent", ev: { t: "text", text: typeof text === "string" ? text : "" } };
      }
    case "tool/call":
      return {
        ...base,
        role: "agent",
        ev: {
          t: "tool-call-start",
          call: String(data["callId"]),
          name: String(data["name"]),
          title: String(data["name"]),
          args: safeJsonParse(data["arguments"])
        }
      };
    case "tool/result": {
      const message = data["message"];
      const content = message?.["content"];
      const firstBlock = Array.isArray(content) ? content[0] : void 0;
      const callId = (typeof firstBlock?.["toolCallId"] === "string" ? firstBlock["toolCallId"] : void 0) ?? (typeof firstBlock?.["callId"] === "string" ? firstBlock["callId"] : void 0) ?? (typeof data["callId"] === "string" ? data["callId"] : "");
      return {
        ...base,
        role: "agent",
        ev: {
          t: "tool-call-end",
          call: callId,
          is_error: data["error"] !== void 0 || firstBlock?.["isError"] === true,
          ...data["error"] !== void 0 ? { error: JSON.stringify(data["error"]) } : {}
        }
      };
    }
    case "todo/write":
    case "request/header":
    case "request/context":
    case "session/end-seed":
    case "step/start":
    case "step/end":
      return options.includeLogEvents ? { ...base, role: "agent", ev: { t: "service", text: event.type } } : null;
    default:
      return event.ignorable === true ? { ...base, role: "agent", ev: { t: "service", text: event.type } } : null;
  }
}
function safeJsonParse(raw) {
  if (typeof raw !== "string") return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
var ENVELOPE_PROXY = "/lynel/proxy/envelope";
var droppedEnvelopes = 0;
var warnedOnce = false;
async function postEnvelope(env) {
  const body = JSON.stringify(env);
  const attempt = async () => {
    try {
      const res = await fetch(ENVELOPE_PROXY, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true
      });
      return res.ok || res.status === 202;
    } catch {
      return false;
    }
  };
  if (await attempt()) return;
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (await attempt()) return;
  droppedEnvelopes += 1;
  if (!warnedOnce) {
    warnedOnce = true;
    console.warn(`[lynel-plugin] envelope endpoint unreachable; ${droppedEnvelopes} envelope(s) dropped so far`);
  }
}
function startEnvelopeForwarder(ctx, options = {}) {
  const controller = new AbortController();
  let seq = 0;
  const startedSessions = /* @__PURE__ */ new Set();
  void (async () => {
    try {
      const stream = ctx.connection.api.events.mux({}, controller.signal);
      for await (const { payload } of stream) {
        if (payload.type === "session/event") {
          const env = toEnvelope(payload.sessionId, payload.event, ++seq, options);
          if (env !== null) void postEnvelope(env);
        } else if (payload.type === "session/subscribed") {
          if (!startedSessions.has(payload.sessionId)) {
            startedSessions.add(payload.sessionId);
            void postEnvelope({
              id: uuid(),
              time: Date.now(),
              seq: ++seq,
              role: "agent",
              sessionId: payload.sessionId,
              agent: options.agent ?? "dsh",
              ev: { t: "start" }
            });
          }
        }
      }
    } catch {
    }
  })();
  return () => controller.abort();
}

// src/client/ask-hook.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function selectQuestion(owner) {
  const found = owner.interactions?.find((item) => item.kind === "question");
  return found ?? null;
}
var ASK_PROXY = "/lynel/proxy/ask";
function AskHookPanel({ matched }) {
  const questions = matched.payload.questions;
  const [phase, setPhase] = (0, import_react.useState)("asking");
  const [detail, setDetail] = (0, import_react.useState)("");
  const [drafts, setDrafts] = (0, import_react.useState)({});
  const [attempt, setAttempt] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ASK_PROXY, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId: matched.key,
            sessionId: matched.sessionId,
            questions,
            ts: Date.now()
          })
        });
        const payload = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && payload !== null && payload.cancelled === true) {
          await respondCancelled(matched);
          setPhase("done");
          return;
        }
        if (res.ok && payload !== null && Array.isArray(payload.answers)) {
          await respondAnswered(matched, { answers: payload.answers });
          setPhase("done");
          return;
        }
        setDetail(`\u540E\u7AEF\u8FD4\u56DE\u5F02\u5E38\uFF08HTTP ${res.status}\uFF09`);
        setPhase("error");
      } catch (error) {
        if (cancelled) return;
        setDetail(error instanceof Error ? error.message : String(error));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matched, attempt]);
  const toggleOption = (questionId, label2, multi) => {
    setDrafts((current) => {
      const draft = current[questionId] ?? { selected: [], custom: "" };
      const selected = multi ? draft.selected.includes(label2) ? draft.selected.filter((item) => item !== label2) : [...draft.selected, label2] : [label2];
      return { ...current, [questionId]: { ...draft, selected } };
    });
  };
  const setCustom = (questionId, custom) => {
    setDrafts((current) => {
      const draft = current[questionId] ?? { selected: [], custom: "" };
      return { ...current, [questionId]: { ...draft, custom } };
    });
  };
  const submitManual = async () => {
    const answers = questions.map((question) => {
      const draft = drafts[question.id] ?? { selected: [], custom: "" };
      return { id: question.id, selected: draft.selected, custom: draft.custom || void 0 };
    });
    await respondAnswered(matched, { answers });
    setPhase("done");
  };
  const waitingStyle = {
    padding: "12px 16px",
    fontSize: 13,
    lineHeight: "20px",
    color: "var(--dsw-alias-label-secondary, #8a8f98)"
  };
  if (phase === "done") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: waitingStyle, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u5DF2\u901A\u8FC7 Lynel \u56DE\u7B54" }) });
  }
  if (phase === "asking") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: waitingStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u7B49\u5F85 Lynel \u540E\u7AEF\u56DE\u7B54\u2026" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: 4, opacity: 0.8 }, children: questions.map((question) => question.question).join(" / ") })
    ] });
  }
  if (phase === "error") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "12px 16px", fontSize: 13 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { color: "var(--dsw-alias-state-error-primary, #f85149)" }, children: [
        "Lynel ask \u94A9\u5B50\u5931\u8D25\uFF1A",
        detail
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 8, display: "flex", gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            onClick: () => {
              setPhase("asking");
              setAttempt((current) => current + 1);
            },
            children: "\u91CD\u8BD5"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => setPhase("manual"), children: "\u5728\u6B64\u624B\u52A8\u56DE\u7B54" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: async () => {
          await respondCancelled(matched);
          setPhase("done");
        }, children: "\u53D6\u6D88" })
      ] })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "12px 16px", fontSize: 13, maxWidth: 520 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontWeight: 600, marginBottom: 8 }, children: "Lynel \u540E\u7AEF\u4E0D\u53EF\u7528 \u2014 \u624B\u52A8\u56DE\u7B54" }),
    questions.map((question, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      QuestionEditor,
      {
        question,
        index,
        draft: drafts[question.id] ?? { selected: [], custom: "" },
        onToggle: toggleOption,
        onCustom: setCustom
      },
      question.id
    )),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 10, display: "flex", gap: 8 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => void submitManual(), children: "\u63D0\u4EA4\u56DE\u7B54" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: async () => {
        await respondCancelled(matched);
        setPhase("done");
      }, children: "\u53D6\u6D88" })
    ] })
  ] });
}
function QuestionEditor({
  question,
  index,
  draft,
  onToggle,
  onCustom
}) {
  const multi = question.multiSelect === true;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { style: { margin: "8px 0", border: "1px solid var(--dsw-alias-border-l1, #2b2e36)", borderRadius: 8, padding: "8px 10px" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("legend", { children: [
      index + 1,
      ". ",
      question.question
    ] }),
    question.header && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { opacity: 0.7 }, children: question.header }),
    question.detail && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { whiteSpace: "pre-wrap", opacity: 0.85 }, children: question.detail }),
    question.options?.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "block", margin: "4px 0" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          type: multi ? "checkbox" : "radio",
          name: question.id,
          checked: draft.selected.includes(option.label),
          onChange: () => onToggle(question.id, option.label, multi)
        }
      ),
      " ",
      option.label,
      option.description && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { opacity: 0.7 }, children: [
        " \u2014 ",
        option.description
      ] })
    ] }, option.label)),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        style: { marginTop: 6, width: "100%", boxSizing: "border-box" },
        placeholder: "\u5176\u4ED6\uFF08\u53EF\u9009\uFF09",
        value: draft.custom,
        onChange: (event) => onCustom(question.id, event.target.value)
      }
    )
  ] });
}
async function respondAnswered(matched, answer) {
  const receipt = await matched.respond({ ok: true, value: { sessionId: matched.sessionId, answer } });
  if (!receipt.accepted) throw new Error(`question response rejected: ${receipt.reason ?? "unknown"}`);
}
async function respondCancelled(matched) {
  const receipt = await matched.respond({
    ok: false,
    error: { code: "cancelled", message: "the user closed this question request", details: {} }
  });
  if (!receipt.accepted) throw new Error(`question cancellation rejected: ${receipt.reason ?? "unknown"}`);
}

// src/client/bind-ui.tsx
var import_react2 = require("react");

// src/client/bots-store.ts
var doc = null;
var listeners = /* @__PURE__ */ new Set();
function notify() {
  for (const listener of listeners) listener();
}
async function refreshBotDoc() {
  try {
    const res = await fetch("/lynel/bot.json");
    doc = res.ok ? await res.json() : null;
  } catch {
    doc = null;
  }
  notify();
  return doc;
}
function subscribeBotDoc(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getBotDocSnapshot() {
  return doc;
}
function botNameOf(bot) {
  if (bot === void 0) return "\u672A\u77E5 bot";
  const name = bot["name"];
  const id = bot["id"];
  if (typeof name === "string" && name !== "") return name;
  return typeof id === "string" ? id : "(\u672A\u547D\u540D bot)";
}
function botById(doc2, botId) {
  return doc2?.bots.find((bot) => String(bot["id"]) === botId);
}

// src/client/bind-ui.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var bindRequest = null;
var listeners2 = /* @__PURE__ */ new Set();
function notify2() {
  for (const listener of listeners2) listener();
}
function subscribe(listener) {
  listeners2.add(listener);
  return () => listeners2.delete(listener);
}
function getSnapshot() {
  return bindRequest;
}
function openBind(sessionId) {
  bindRequest = { sessionId };
  notify2();
}
function closeBind() {
  bindRequest = null;
  notify2();
}
var BIND_EVENT = "lynel:bind-bot";
function installBindEvent(windowRef) {
  const onEvent = (event) => {
    const detail = event.detail;
    if (typeof detail?.sessionId === "string" && detail.sessionId !== "") openBind(detail.sessionId);
  };
  windowRef.addEventListener(BIND_EVENT, onEvent);
  return () => windowRef.removeEventListener(BIND_EVENT, onEvent);
}
async function fetchBotDoc() {
  const res = await fetch("/lynel/bot.json");
  if (!res.ok) throw new Error(`bot.json: HTTP ${res.status}`);
  return await res.json();
}
async function mutateBotDoc(body) {
  const res = await fetch("/lynel/bot.json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`bot.json: HTTP ${res.status}`);
  return await res.json();
}
function botName(bot) {
  const name = bot["name"];
  const id = bot["id"];
  if (typeof name === "string" && name !== "") return name;
  return typeof id === "string" ? id : "(\u672A\u547D\u540D bot)";
}
function sessionTitleOf(sessionsById, sessionId) {
  return sessionsById[sessionId]?.displayTitle ?? sessionId;
}
function BindModal({ useSessions }) {
  const request = (0, import_react2.useSyncExternalStore)(subscribe, getSnapshot);
  const sessionsById = useSessions((state) => state.byId);
  const [doc2, setDoc] = (0, import_react2.useState)(null);
  const [config, setConfig] = (0, import_react2.useState)(null);
  const [picked, setPicked] = (0, import_react2.useState)("");
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)("");
  const [saved, setSaved] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => {
    if (request === null) return;
    let cancelled = false;
    setError("");
    setSaved(false);
    setBusy(true);
    void (async () => {
      try {
        const [cfgRes, botRes] = await Promise.all([
          fetch("/lynel/config").then((res) => res.ok ? res.json() : null),
          fetchBotDoc()
        ]);
        if (cancelled) return;
        setConfig(cfgRes);
        setDoc(botRes);
        setPicked(botRes.sessions[request.sessionId] ?? "");
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);
  if (request === null) return null;
  const boundBotId = doc2?.sessions[request.sessionId];
  const doBind = async () => {
    if (picked === "") return;
    setBusy(true);
    setError("");
    try {
      const next = await mutateBotDoc({ action: "bind", sessionId: request.sessionId, botId: picked });
      setDoc(next);
      setSaved(true);
      void refreshBotDoc();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const doUnbind = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await mutateBotDoc({ action: "unbind", sessionId: request.sessionId });
      setDoc(next);
      setPicked("");
      setSaved(true);
      void refreshBotDoc();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const overlayStyle = {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.45)",
    zIndex: 1e3,
    pointerEvents: "auto"
  };
  const cardStyle = {
    width: 380,
    maxWidth: "calc(100vw - 48px)",
    maxHeight: "70vh",
    overflow: "auto",
    background: "var(--dsw-alias-bg-layer-1, #1b1d22)",
    color: "var(--dsw-alias-label-primary, #e6e6e6)",
    border: "1px solid var(--dsw-alias-border-l1, #2b2e36)",
    borderRadius: 12,
    padding: "16px 18px",
    fontSize: 13,
    lineHeight: "20px"
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: overlayStyle, onClick: closeBind, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: cardStyle, onClick: (event) => event.stopPropagation(), children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { style: { fontSize: 14 }, children: "\u7ED1\u5B9A Bot" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: closeBind, style: { border: "none", background: "none", color: "inherit", cursor: "pointer", fontSize: 14 }, children: "\u2715" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { opacity: 0.75, marginBottom: 10 }, children: [
      "\u4F1A\u8BDD\uFF1A",
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: request.sessionId })
    ] }),
    busy && !doc2 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { opacity: 0.7 }, children: "\u52A0\u8F7D bot \u5217\u8868\u2026" }) : error && doc2 === null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #f85149)" }, children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { marginTop: 6, opacity: 0.8 }, children: config ? `\u672A\u627E\u5230 ${config.botFile}` : "\u8BF7\u786E\u8BA4 lynel-plugin \u5BBF\u4E3B\u7AEF\u5DF2\u52A0\u8F7D\uFF08/lynel/bot.json \u4E0D\u53EF\u7528\uFF09" })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      boundBotId !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { marginBottom: 10 }, children: [
        "\u5F53\u524D\u7ED1\u5B9A\uFF1A",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: botName(doc2?.bots.find((bot) => String(bot["id"]) === boundBotId) ?? { id: boundBotId }) })
      ] }),
      (doc2?.bots.length ?? 0) === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { opacity: 0.75 }, children: "bot.json \u4E2D\u6CA1\u6709\u6CE8\u518C\u4EFB\u4F55 bot\u3002" }) : doc2?.bots.map((bot) => {
        const id = String(bot["id"]);
        const owner = doc2 === null ? void 0 : Object.entries(doc2.sessions).find(([, bid]) => bid === id)?.[0];
        const isCurrent = owner === request.sessionId;
        const isOtherBound = owner !== void 0 && owner !== request.sessionId;
        const statusColor = isCurrent ? "var(--dsw-alias-state-success-primary, #3fb950)" : "var(--dsw-alias-label-secondary, #8a8f98)";
        const statusText = isCurrent ? "\u5F53\u524D\u4F1A\u8BDD\u5DF2\u7ED1\u5B9A" : isOtherBound ? `\u5DF2\u7ED1\u5B9A\u5230\u300C${sessionTitleOf(sessionsById, owner)}\u300D` : "\u672A\u7ED1\u5B9A";
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "label",
          {
            style: {
              display: "block",
              margin: "6px 0",
              padding: "6px 10px",
              border: "1px solid var(--dsw-alias-border-l1, #2b2e36)",
              borderRadius: 8,
              cursor: isOtherBound ? "not-allowed" : "pointer",
              opacity: isOtherBound ? 0.55 : 1
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "input",
                {
                  type: "radio",
                  name: "lynel-bot",
                  checked: picked === id,
                  disabled: isOtherBound,
                  onChange: () => setPicked(id)
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontWeight: 500 }, children: botName(bot) }),
              typeof bot["type"] === "string" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { opacity: 0.6 }, children: [
                "\uFF08",
                bot["type"],
                "\uFF09"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { marginLeft: "auto", fontSize: 11, color: statusColor, whiteSpace: "nowrap" }, children: statusText })
            ] })
          },
          id
        );
      }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { marginTop: 12, display: "flex", gap: 8, alignItems: "center" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            disabled: busy || picked === "" || picked === boundBotId,
            onClick: () => void doBind(),
            title: picked === boundBotId ? "\u8BE5 bot \u5DF2\u7ED1\u5B9A\u5F53\u524D\u4F1A\u8BDD" : void 0,
            children: "\u7ED1\u5B9A"
          }
        ),
        boundBotId !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: busy, onClick: () => void doUnbind(), children: "\u89E3\u7ED1" }),
        saved && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { color: "var(--dsw-alias-state-success-primary, #3fb950)" }, children: "\u5DF2\u4FDD\u5B58" })
      ] }),
      picked !== "" && picked === boundBotId && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { marginTop: 6, fontSize: 12, color: "var(--dsw-alias-label-secondary, #8a8f98)" }, children: "\u8BE5 bot \u5DF2\u7ED1\u5B9A\u5F53\u524D\u4F1A\u8BDD\uFF0C\u65E0\u9700\u91CD\u590D\u7ED1\u5B9A\uFF1B\u5982\u9700\u66F4\u6362\u8BF7\u9009\u62E9\u5176\u4ED6 bot \u6216\u5148\u89E3\u7ED1\u3002" }),
      error !== "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #f85149)", marginTop: 8 }, children: error })
    ] })
  ] }) });
}
function BindHeaderButton({ sessionId }) {
  const doc2 = (0, import_react2.useSyncExternalStore)(subscribeBotDoc, getBotDocSnapshot);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [failed, setFailed] = (0, import_react2.useState)(false);
  const boundBotId = doc2?.sessions[sessionId];
  const doUnbind = () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    void (async () => {
      try {
        const res = await fetch("/lynel/bot.json", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "unbind", sessionId })
        });
        if (!res.ok) throw new Error(`unbind failed: HTTP ${res.status}`);
        await refreshBotDoc();
      } catch (cause) {
        console.error("[lynel-plugin] unbind failed:", cause);
        setFailed(true);
      } finally {
        setBusy(false);
      }
    })();
  };
  const bound = boundBotId !== void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    "button",
    {
      type: "button",
      disabled: busy,
      title: bound ? `\u89E3\u7ED1 ${doc2?.bots.find((bot) => String(bot["id"]) === boundBotId)?.name ?? boundBotId}` : "\u7ED1\u5B9A/\u89E3\u7ED1 Lynel Bot",
      onClick: () => bound ? doUnbind() : openBind(sessionId),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        padding: "3px 8px",
        borderRadius: 6,
        border: "1px solid var(--dsw-alias-border-l1, #2b2e36)",
        background: "transparent",
        color: bound ? "var(--dsw-alias-state-error-primary, #f85149)" : "inherit",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1
      },
      children: busy ? "\u89E3\u7ED1\u4E2D\u2026" : failed ? "\u89E3\u7ED1\u5931\u8D25" : bound ? "\u89E3\u7ED1" : "\u7ED1\u5B9A Bot"
    }
  );
}

// src/client/bots-settings.tsx
var import_react3 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime3 = require("react/jsx-runtime");
var BOT_TYPES = [
  { value: "wecom", label: "\u4F01\u4E1A\u5FAE\u4FE1" },
  { value: "telegram", label: "Telegram" },
  { value: "dingtalk", label: "\u9489\u9489" },
  { value: "slack", label: "Slack" },
  { value: "custom", label: "\u5176\u4ED6" }
];
function typeLabel(type) {
  if (type === "") return "\u672A\u8BBE\u7F6E";
  return BOT_TYPES.find((entry) => entry.value === type)?.label ?? type;
}
var c = {
  bg: "var(--dsw-alias-bg-layer-1, #1b1d22)",
  border: "var(--dsw-alias-border-l1, #2b2e36)",
  labelPrimary: "var(--dsw-alias-label-primary, #e6e6e6)",
  labelSecondary: "var(--dsw-alias-label-secondary, #8a8f98)",
  brand: "var(--dsw-alias-brand-primary, #4c8dff)",
  success: "var(--dsw-alias-state-success-primary, #3fb950)",
  error: "var(--dsw-alias-state-error-primary, #f85149)",
  hover: "var(--dsw-alias-interactive-bg-hover, #26292f)"
};
var label = {
  minWidth: 64,
  fontSize: 13,
  color: c.labelSecondary,
  display: "inline-flex",
  alignItems: "center"
};
var fieldRow = { display: "flex", alignItems: "center", gap: 10, margin: "8px 0" };
var controlWrap = { flex: 1, minWidth: 0 };
var inputStyle = { width: "100%", boxSizing: "border-box" };
var selectStyle = {
  width: "100%",
  height: 30,
  padding: "0 8px",
  fontSize: 13,
  color: c.labelPrimary,
  background: c.bg,
  border: `1px solid ${c.border}`,
  borderRadius: 6,
  outline: "none"
};
var card = {
  background: c.bg,
  border: `1px solid ${c.border}`,
  borderRadius: 10,
  padding: "12px 14px",
  marginBottom: 10
};
function BotsSettingsSection({ useSessions }) {
  const sessionsById = useSessions((state) => state.byId);
  const [doc2, setDoc] = (0, import_react3.useState)(null);
  const [config, setConfig] = (0, import_react3.useState)(null);
  const [busy, setBusy] = (0, import_react3.useState)(true);
  const [error, setError] = (0, import_react3.useState)("");
  const [notice, setNotice] = (0, import_react3.useState)("");
  const [newName, setNewName] = (0, import_react3.useState)("");
  const [newType, setNewType] = (0, import_react3.useState)("wecom");
  const [newBotId, setNewBotId] = (0, import_react3.useState)("");
  const [newSecret, setNewSecret] = (0, import_react3.useState)("");
  const [confirmDelete, setConfirmDelete] = (0, import_react3.useState)(null);
  const [showForm, setShowForm] = (0, import_react3.useState)(false);
  (0, import_react3.useEffect)(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cfgRes, botRes] = await Promise.all([
          fetch("/lynel/config").then((res) => res.ok ? res.json() : null),
          fetch("/lynel/bot.json")
        ]);
        if (cancelled) return;
        setConfig(cfgRes);
        if (botRes.ok) {
          setDoc(await botRes.json());
        } else {
          setError(`\u672A\u627E\u5230 bot.json\uFF08${cfgRes?.botFile ?? "?"}\uFF09`);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const mutate = async (body) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/lynel/bot.json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? `HTTP ${res.status}`);
      }
      setDoc(await res.json());
      void refreshBotDoc();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const addBot = () => {
    const name = newName.trim();
    const botId = newBotId.trim();
    if (name === "") return setError("\u8BF7\u586B\u5199 Bot \u540D\u79F0");
    if (botId === "") return setError("\u8BF7\u586B\u5199 BotId");
    const type = newType === "custom" ? "custom" : newType;
    const bot = { id: botId, name, type };
    if (newSecret !== "") bot["secret"] = newSecret;
    void (async () => {
      await mutate({ action: "add-bot", bot });
      if (error === "") {
        setNewName("");
        setNewBotId("");
        setNewSecret("");
        setNotice(`\u5DF2\u6DFB\u52A0 bot\u300C${name}\u300D`);
      }
    })();
  };
  const removeBot = (botId) => {
    if (confirmDelete !== botId) {
      setConfirmDelete(botId);
      return;
    }
    setConfirmDelete(null);
    void mutate({ action: "remove-bot", botId });
  };
  const unbindBot = (botId) => {
    setConfirmDelete(null);
    void mutate({ action: "unbind-bot", botId });
  };
  const boundSessionsOf = (botId) => {
    if (doc2 === null) return [];
    return Object.entries(doc2.sessions).filter(([, bid]) => bid === botId).map(([sid]) => ({
      id: sid,
      title: sessionsById[sid]?.displayTitle ?? sid
    }));
  };
  const botTypeOf = (bot) => typeof bot["type"] === "string" ? bot["type"] : "";
  const botSecretOf = (bot) => typeof bot["secret"] === "string" ? bot["secret"] : "";
  const botIdOf = (bot) => typeof bot["id"] === "string" ? bot["id"] : "";
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { fontSize: 13, lineHeight: "20px", color: c.labelPrimary }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { style: { fontSize: 15, fontWeight: 600, margin: "0 0 2px" }, children: "Bot \u8BBE\u7F6E" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { color: c.labelSecondary, marginBottom: 14, wordBreak: "break-all" }, children: [
      "\u6587\u4EF6\uFF1A",
      config?.botFile ?? "~/.lynel-desktop/bot.json"
    ] }),
    busy && doc2 === null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { color: c.labelSecondary }, children: "\u52A0\u8F7D\u4E2D\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { fontWeight: 600, margin: "4px 0 8px" }, children: [
        "\u5DF2\u6CE8\u518C\u7684 Bot\uFF08",
        doc2?.bots.length ?? 0,
        "\uFF09"
      ] }),
      (doc2?.bots.length ?? 0) === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { color: c.labelSecondary, marginBottom: 12 }, children: "\u8FD8\u6CA1\u6709 bot\uFF0C\u70B9\u4E0B\u65B9\u300C\u6DFB\u52A0 Bot\u300D\u6DFB\u52A0\u7B2C\u4E00\u4E2A\u3002" }) : doc2?.bots.map((bot) => {
        const id = botIdOf(bot);
        const name = typeof bot["name"] === "string" && bot["name"] !== "" ? bot["name"] : id;
        const type = typeLabel(botTypeOf(bot));
        const secret = botSecretOf(bot);
        const bound = boundSessionsOf(id);
        const boundNames = bound.map((session) => session.title).join("\u3001");
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: card, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontWeight: 600, whiteSpace: "nowrap" }, children: name }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "span",
            {
              style: {
                fontSize: 11,
                padding: "1px 8px",
                borderRadius: 99,
                border: `1px solid ${c.border}`,
                color: c.labelSecondary,
                whiteSpace: "nowrap",
                flexShrink: 0
              },
              children: type
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "span",
            {
              style: {
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                color: c.labelSecondary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              },
              title: `BotId\uFF1A${id}` + (secret !== "" ? "\nSecret\uFF1A\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "") + (bound.length > 0 ? `
\u7ED1\u5B9A\u4F1A\u8BDD\uFF08${bound.length}\uFF09\uFF1A
${boundNames}` : ""),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("code", { children: id }),
                secret !== "" && " \xB7 Secret\uFF1A\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
                bound.length > 0 && ` \xB7 \u7ED1\u5B9A ${bound.length} \u4E2A\u4F1A\u8BDD\uFF1A${boundNames}`
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            import_dsh_client_ui_primitives.Button,
            {
              type: "button",
              variant: "ghost",
              size: "sm",
              disabled: bound.length === 0 || busy,
              title: bound.length === 0 ? "\u8BE5 bot \u672A\u7ED1\u5B9A\u4EFB\u4F55\u4F1A\u8BDD" : `\u89E3\u7ED1\u6240\u6709\u4F1A\u8BDD\uFF1A
${boundNames}`,
              onClick: () => unbindBot(id),
              style: { flexShrink: 0 },
              children: "\u89E3\u7ED1"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            import_dsh_client_ui_primitives.Button,
            {
              type: "button",
              variant: "outline",
              size: "sm",
              disabled: busy,
              onClick: () => removeBot(id),
              style: {
                color: c.error,
                borderColor: confirmDelete === id ? c.error : void 0,
                flexShrink: 0
              },
              children: confirmDelete === id ? "\u786E\u8BA4\u5220\u9664\uFF1F" : "\u5220\u9664"
            }
          )
        ] }) }, id);
      }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { marginTop: 4 }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        import_dsh_client_ui_primitives.Button,
        {
          type: "button",
          variant: showForm ? "ghost" : "primary",
          size: "sm",
          onClick: () => {
            setShowForm((open) => !open);
            setNotice("");
            setError("");
          },
          children: showForm ? "\u6536\u8D77" : "\uFF0B \u6DFB\u52A0 Bot"
        }
      ) }),
      showForm && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...card, marginTop: 10 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: fieldRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: label, children: "\u540D\u79F0 *" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: controlWrap, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Input, { style: inputStyle, value: newName, placeholder: "\u4F8B\u5982\uFF1A\u4F01\u5FAE\u4E3B\u53F7", onChange: (e) => setNewName(e.target.value) }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: fieldRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: label, children: "\u7C7B\u578B *" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: controlWrap, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("select", { style: selectStyle, value: newType, onChange: (e) => setNewType(e.target.value), children: BOT_TYPES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: entry.value, children: entry.label }, entry.value)) }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: fieldRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: label, children: "BotId *" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: controlWrap, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Input, { style: inputStyle, value: newBotId, placeholder: "\u552F\u4E00\u6807\u8BC6\uFF0C\u7528\u4E8E\u4F1A\u8BDD\u7ED1\u5B9A", onChange: (e) => setNewBotId(e.target.value) }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: fieldRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: label, children: "Secret" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: controlWrap, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Input, { style: inputStyle, type: "password", value: newSecret, placeholder: "\u5BC6\u94A5\uFF08\u53EF\u9009\uFF09", onChange: (e) => setNewSecret(e.target.value) }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { marginTop: 12, display: "flex", alignItems: "center", gap: 10 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "primary", size: "md", disabled: busy, onClick: addBot, children: "\u6DFB\u52A0 Bot" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "ghost", size: "md", disabled: busy, onClick: () => setShowForm(false), children: "\u53D6\u6D88" }),
          notice !== "" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { color: c.success, fontSize: 12 }, children: notice })
        ] })
      ] })
    ] }),
    error !== "" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { color: c.error, marginTop: 10, fontSize: 12 }, children: error })
  ] });
}

// src/client/bot-badge.tsx
var import_react4 = require("react");
var import_jsx_runtime4 = require("react/jsx-runtime");
var pill = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  lineHeight: "16px",
  padding: "2px 8px",
  borderRadius: 99,
  border: "1px solid var(--dsw-alias-border-l1, #2b2e36)",
  background: "var(--dsw-alias-bg-layer-1, #1b1d22)",
  color: "var(--dsw-alias-label-primary, #e6e6e6)",
  whiteSpace: "nowrap"
};
function BotBadge({ sessionId }) {
  const doc2 = (0, import_react4.useSyncExternalStore)(subscribeBotDoc, getBotDocSnapshot);
  const botId = doc2?.sessions[sessionId];
  if (botId === void 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { style: pill, title: `\u5DF2\u7ED1\u5B9A Bot\uFF1A${botId}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": true, children: "\u{1F916}" }),
    botNameOf(botById(doc2, botId))
  ] });
}

// src/client/index.tsx
var inject = ["connection", "slots"];
function apply(ctx) {
  ctx.effect(
    () => startEnvelopeForwarder(ctx),
    "lynel-plugin: envelope forwarder"
  );
  void refreshBotDoc();
  ctx.effect(() => {
    const disposers = [];
    disposers.push(
      ctx.slots.inject(
        "conversation.composer",
        () => ctx.slots.register(
          {
            name: "conversation.composer",
            select: selectQuestion,
            priority: -100
          },
          AskHookPanel
        )
      )
    );
    disposers.push(
      ctx.slots.inject(
        "conversation.session.header.actions",
        () => ctx.slots.register(
          {
            name: "conversation.session.header.actions",
            id: "lynel-bind-bot",
            order: 1e3
          },
          BindHeaderButton
        )
      )
    );
    disposers.push(
      ctx.slots.inject(
        "conversation.session.header.actions",
        () => ctx.slots.register(
          {
            name: "conversation.session.header.actions",
            id: "lynel-bot-badge",
            order: 990
          },
          BotBadge
        )
      )
    );
    disposers.push(
      ctx.slots.inject(
        "shell.overlay",
        () => ctx.slots.register(
          {
            name: "shell.overlay",
            id: "lynel-bind-modal",
            order: 100
          },
          BindModal
        )
      )
    );
    disposers.push(
      ctx.slots.inject(
        "settings.section",
        () => ctx.slots.register(
          {
            name: "settings.section",
            id: "lynel-bots",
            order: 20,
            label: () => "Bot \u8BBE\u7F6E"
          },
          BotsSettingsSection
        )
      )
    );
    disposers.push(installBindEvent(window));
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "lynel-plugin: bind-bot UI");
}

		return module.exports;
	}
});
