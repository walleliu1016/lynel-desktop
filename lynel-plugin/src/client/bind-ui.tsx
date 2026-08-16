/**
 * lynel-plugin — bind-bot UI.
 *
 * Two pure-plugin surfaces plus one patched entry point:
 *
 *  - `conversation.session.header.actions` (session scope): a "绑定 Bot"
 *    button beside the session title — works with zero patching.
 *  - `shell.overlay` (root scope): the bind modal, opened from the header
 *    button or from the `lynel:bind-bot` window event (dispatched by the
 *    optional ui-workspace row-menu patch — the sidebar "归档会话" placement).
 *
 * bot.json I/O goes through the host routes (GET/POST /lynel/bot.json).
 */

import { useEffect, useSyncExternalStore, useState, type CSSProperties } from 'react';
import { getBotDocSnapshot, refreshBotDoc, subscribeBotDoc } from './bots-store';
import type { LynelBotDoc, LynelPluginConfig, SessionListStateLike, SessionSummaryLike } from './types';

/* ── module-level bind-request store (crosses slot boundaries) ───────────── */

interface BindRequest {
  sessionId: string;
}

let bindRequest: BindRequest | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): BindRequest | null {
  return bindRequest;
}

/** Open the bind modal for a session (idempotent). */
export function openBind(sessionId: string): void {
  bindRequest = { sessionId };
  notify();
}

function closeBind(): void {
  bindRequest = null;
  notify();
}

const BIND_EVENT = 'lynel:bind-bot';

/** Wire the window event the ui-workspace menu patch dispatches. */
export function installBindEvent(windowRef: Window): () => void {
  const onEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
    if (typeof detail?.sessionId === 'string' && detail.sessionId !== '') openBind(detail.sessionId);
  };
  windowRef.addEventListener(BIND_EVENT, onEvent);
  return () => windowRef.removeEventListener(BIND_EVENT, onEvent);
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

async function fetchBotDoc(): Promise<LynelBotDoc> {
  const res = await fetch('/lynel/bot.json');
  if (!res.ok) throw new Error(`bot.json: HTTP ${res.status}`);
  return (await res.json()) as LynelBotDoc;
}

async function mutateBotDoc(body: Record<string, unknown>): Promise<LynelBotDoc> {
  const res = await fetch('/lynel/bot.json', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`bot.json: HTTP ${res.status}`);
  return (await res.json()) as LynelBotDoc;
}

function botName(bot: Record<string, unknown>): string {
  const name = bot['name'];
  const id = bot['id'];
  if (typeof name === 'string' && name !== '') return name;
  return typeof id === 'string' ? id : '(未命名 bot)';
}

/* ── shell.overlay entry: the modal ──────────────────────────────────────── */

interface BindModalProps {
  /** Framework-injected global session-list selector hook. */
  useSessions: <T>(selector: (state: SessionListStateLike) => T) => T;
}

/** Resolve a session id to a display title (fallback: the raw id). */
function sessionTitleOf(sessionsById: Record<string, SessionSummaryLike>, sessionId: string): string {
  return sessionsById[sessionId]?.displayTitle ?? sessionId;
}

export function BindModal({ useSessions }: BindModalProps): JSX.Element | null {
  const request = useSyncExternalStore(subscribe, getSnapshot);
  const sessionsById = useSessions((state) => state.byId) as Record<string, SessionSummaryLike>;
  const [doc, setDoc] = useState<LynelBotDoc | null>(null);
  const [config, setConfig] = useState<LynelPluginConfig | null>(null);
  const [picked, setPicked] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (request === null) return;
    let cancelled = false;
    setError('');
    setSaved(false);
    setBusy(true);
    void (async () => {
      try {
        const [cfgRes, botRes] = await Promise.all([
          fetch('/lynel/config').then((res) => (res.ok ? res.json() : null)),
          fetchBotDoc(),
        ]);
        if (cancelled) return;
        setConfig(cfgRes as LynelPluginConfig | null);
        setDoc(botRes);
        setPicked(botRes.sessions[request.sessionId] ?? '');
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

  const boundBotId = doc?.sessions[request.sessionId];

  const doBind = async (): Promise<void> => {
    if (picked === '') return;
    setBusy(true);
    setError('');
    try {
      const next = await mutateBotDoc({ action: 'bind', sessionId: request.sessionId, botId: picked });
      setDoc(next);
      setSaved(true);
      void refreshBotDoc();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const doUnbind = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const next = await mutateBotDoc({ action: 'unbind', sessionId: request.sessionId });
      setDoc(next);
      setPicked('');
      setSaved(true);
      void refreshBotDoc();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.45)',
    zIndex: 1000,
    pointerEvents: 'auto',
  };

  const cardStyle: CSSProperties = {
    width: 380,
    maxWidth: 'calc(100vw - 48px)',
    maxHeight: '70vh',
    overflow: 'auto',
    background: 'var(--dsw-alias-bg-layer-1, #1b1d22)',
    color: 'var(--dsw-alias-label-primary, #e6e6e6)',
    border: '1px solid var(--dsw-alias-border-l1, #2b2e36)',
    borderRadius: 12,
    padding: '16px 18px',
    fontSize: 13,
    lineHeight: '20px',
  };

  return (
    <div style={overlayStyle} onClick={closeBind}>
      <div style={cardStyle} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>绑定 Bot</strong>
          <button type="button" onClick={closeBind} style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }}>
            ✕
          </button>
        </div>

        <div style={{ opacity: 0.75, marginBottom: 10 }}>
          会话：<code>{request.sessionId}</code>
        </div>

        {busy && !doc ? (
          <div style={{ opacity: 0.7 }}>加载 bot 列表…</div>
        ) : error && doc === null ? (
          <div>
            <div style={{ color: 'var(--dsw-alias-state-error-primary, #f85149)' }}>{error}</div>
            <div style={{ marginTop: 6, opacity: 0.8 }}>
              {config ? `未找到 ${config.botFile}` : '请确认 lynel-plugin 宿主端已加载（/lynel/bot.json 不可用）'}
            </div>
          </div>
        ) : (
          <>
            {boundBotId !== undefined && (
              <div style={{ marginBottom: 10 }}>
                当前绑定：<strong>{botName(doc?.bots.find((bot) => String(bot['id']) === boundBotId) ?? { id: boundBotId })}</strong>
              </div>
            )}
            {(doc?.bots.length ?? 0) === 0 ? (
              <div style={{ opacity: 0.75 }}>bot.json 中没有注册任何 bot。</div>
            ) : (
              doc?.bots.map((bot) => {
                const id = String(bot['id']);
                const owner = doc === null ? undefined : Object.entries(doc.sessions).find(([, bid]) => bid === id)?.[0];
                const isCurrent = owner === request.sessionId;
                const isOtherBound = owner !== undefined && owner !== request.sessionId;
                const statusColor = isCurrent
                  ? 'var(--dsw-alias-state-success-primary, #3fb950)'
                  : 'var(--dsw-alias-label-secondary, #8a8f98)';
                const statusText = isCurrent
                  ? '当前会话已绑定'
                  : isOtherBound
                    ? `已绑定到「${sessionTitleOf(sessionsById, owner)}」`
                    : '未绑定';
                return (
                  <label
                    key={id}
                    style={{
                      display: 'block',
                      margin: '6px 0',
                      padding: '6px 10px',
                      border: '1px solid var(--dsw-alias-border-l1, #2b2e36)',
                      borderRadius: 8,
                      cursor: isOtherBound ? 'not-allowed' : 'pointer',
                      opacity: isOtherBound ? 0.55 : 1,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="radio"
                        name="lynel-bot"
                        checked={picked === id}
                        disabled={isOtherBound}
                        onChange={() => setPicked(id)}
                      />
                      <span style={{ fontWeight: 500 }}>{botName(bot)}</span>
                      {typeof bot['type'] === 'string' && <span style={{ opacity: 0.6 }}>（{bot['type']}）</span>}
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: statusColor, whiteSpace: 'nowrap' }}>
                        {statusText}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                disabled={busy || picked === '' || picked === boundBotId}
                onClick={() => void doBind()}
                title={picked === boundBotId ? '该 bot 已绑定当前会话' : undefined}
              >
                绑定
              </button>
              {boundBotId !== undefined && (
                <button type="button" disabled={busy} onClick={() => void doUnbind()}>
                  解绑
                </button>
              )}
              {saved && <span style={{ color: 'var(--dsw-alias-state-success-primary, #3fb950)' }}>已保存</span>}
            </div>
            {picked !== '' && picked === boundBotId && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #8a8f98)' }}>
                该 bot 已绑定当前会话，无需重复绑定；如需更换请选择其他 bot 或先解绑。
              </div>
            )}
            {error !== '' && <div style={{ color: 'var(--dsw-alias-state-error-primary, #f85149)', marginTop: 8 }}>{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}

/* ── conversation.session.header.actions entry: the button ───────────────── */

interface HeaderActionProps {
  sessionId: string;
}

/**
 * Header button, state-driven by the bot-doc cache:
 *  - not bound → "绑定 Bot" opens the bind modal
 *  - bound     → "解绑" unbinds the current session directly (then flips back)
 */
export function BindHeaderButton({ sessionId }: HeaderActionProps): JSX.Element {
  const doc = useSyncExternalStore(subscribeBotDoc, getBotDocSnapshot);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const boundBotId = doc?.sessions[sessionId];

  const doUnbind = (): void => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    void (async () => {
      try {
        const res = await fetch('/lynel/bot.json', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'unbind', sessionId }),
        });
        if (!res.ok) throw new Error(`unbind failed: HTTP ${res.status}`);
        await refreshBotDoc();
      } catch (cause) {
        console.error('[lynel-plugin] unbind failed:', cause);
        setFailed(true);
      } finally {
        setBusy(false);
      }
    })();
  };

  const bound = boundBotId !== undefined;
  return (
    <button
      type="button"
      disabled={busy}
      title={bound ? `解绑 ${doc?.bots.find((bot) => String(bot['id']) === boundBotId)?.name ?? boundBotId}` : '绑定/解绑 Lynel Bot'}
      onClick={() => (bound ? doUnbind() : openBind(sessionId))}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        padding: '3px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1, #2b2e36)',
        background: 'transparent',
        color: bound
          ? 'var(--dsw-alias-state-error-primary, #f85149)'
          : 'inherit',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? '解绑中…' : failed ? '解绑失败' : bound ? '解绑' : '绑定 Bot'}
    </button>
  );
}
