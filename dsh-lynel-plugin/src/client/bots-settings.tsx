/**
 * dsh-lynel-plugin — Bot 设置 settings section.
 *
 * Registers into `settings.section` (the settings-page nav list). The page
 * lists the bots in `~/.lynel-desktop/bot.json`, adds new ones, and deletes
 * existing ones (deleting also unbinds every session bound to the bot).
 *
 * Bot record shape (canonical):
 *   { "id": "<BotId>", "name": "…", "type": "wecom", "secret": "…" }
 * `id` is the BotId — the unique key session bindings point at. `type` is a
 * dropdown (企业微信 / Telegram / 钉钉 / Slack / 其他), `secret` is stored
 * as-is and masked in the list.
 *
 * UI uses the DSH primitives (Button / Input) and the real theme tokens
 * (--dsw-alias-bg-layer-1, --dsw-alias-border-l1, …).
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { refreshBotDoc } from './bots-store';
import type { LynelBotDoc, LynelPluginConfig, SessionListStateLike, SessionSummaryLike } from './types';

interface BotsSettingsSectionProps {
  /** Close the settings panel (shell owner affordance). */
  close: () => void;
  /** Framework-injected global session-list selector hook. */
  useSessions: <T>(selector: (state: SessionListStateLike) => T) => T;
}

/** Dropdown options for the bot type field. */
const BOT_TYPES = [
  { value: 'wecom', label: '企业微信' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'dingtalk', label: '钉钉' },
  { value: 'slack', label: 'Slack' },
  { value: 'custom', label: '其他' },
] as const;

function typeLabel(type: string): string {
  if (type === '') return '未设置';
  return BOT_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

/* ── styling (real theme tokens; fallbacks only for safety) ─────────────── */

const c = {
  bg: 'var(--dsw-alias-bg-layer-1, #1b1d22)',
  border: 'var(--dsw-alias-border-l1, #2b2e36)',
  labelPrimary: 'var(--dsw-alias-label-primary, #e6e6e6)',
  labelSecondary: 'var(--dsw-alias-label-secondary, #8a8f98)',
  brand: 'var(--dsw-alias-brand-primary, #4c8dff)',
  success: 'var(--dsw-alias-state-success-primary, #3fb950)',
  error: 'var(--dsw-alias-state-error-primary, #f85149)',
  hover: 'var(--dsw-alias-interactive-bg-hover, #26292f)',
};

const label: CSSProperties = {
  minWidth: 64,
  fontSize: 13,
  color: c.labelSecondary,
  display: 'inline-flex',
  alignItems: 'center',
};

const fieldRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' };

const controlWrap: CSSProperties = { flex: 1, minWidth: 0 };

const inputStyle: CSSProperties = { width: '100%', boxSizing: 'border-box' };

const selectStyle: CSSProperties = {
  width: '100%',
  height: 30,
  padding: '0 8px',
  fontSize: 13,
  color: c.labelPrimary,
  background: c.bg,
  border: `1px solid ${c.border}`,
  borderRadius: 6,
  outline: 'none',
};

const card: CSSProperties = {
  background: c.bg,
  border: `1px solid ${c.border}`,
  borderRadius: 10,
  padding: '12px 14px',
  marginBottom: 10,
};

/* ── component ──────────────────────────────────────────────────────────── */

export function BotsSettingsSection({ useSessions }: BotsSettingsSectionProps): JSX.Element {
  const sessionsById = useSessions((state) => state.byId) as Record<string, SessionSummaryLike>;
  const [doc, setDoc] = useState<LynelBotDoc | null>(null);
  const [config, setConfig] = useState<LynelPluginConfig | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // add-bot form
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<string>('wecom');
  const [newBotId, setNewBotId] = useState('');
  const [newSecret, setNewSecret] = useState('');
  // delete confirmation: botId currently armed
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // add-form visibility (form hidden until the 添加 Bot button is clicked)
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cfgRes, botRes] = await Promise.all([
          fetch('/lynel/config').then((res) => (res.ok ? res.json() : null)),
          fetch('/lynel/bot.json'),
        ]);
        if (cancelled) return;
        setConfig(cfgRes as LynelPluginConfig | null);
        if (botRes.ok) {
          setDoc((await botRes.json()) as LynelBotDoc);
        } else {
          setError(`未找到 bot.json（${(cfgRes as LynelPluginConfig | null)?.botFile ?? '?'}）`);
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

  const mutate = async (body: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/lynel/bot.json', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${res.status}`);
      }
      setDoc((await res.json()) as LynelBotDoc);
      void refreshBotDoc();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const addBot = (): void => {
    const name = newName.trim();
    const botId = newBotId.trim();
    if (name === '') return setError('请填写 Bot 名称');
    if (botId === '') return setError('请填写 BotId');
    const type = newType === 'custom' ? 'custom' : newType;
    const bot: Record<string, unknown> = { id: botId, name, type };
    if (newSecret !== '') bot['secret'] = newSecret;
    void (async () => {
      await mutate({ action: 'add-bot', bot });
      if (error === '') {
        setNewName('');
        setNewBotId('');
        setNewSecret('');
        setNotice(`已添加 bot「${name}」`);
      }
    })();
  };

  const removeBot = (botId: string): void => {
    if (confirmDelete !== botId) {
      setConfirmDelete(botId);
      return;
    }
    setConfirmDelete(null);
    void mutate({ action: 'remove-bot', botId });
  };

  const unbindBot = (botId: string): void => {
    setConfirmDelete(null);
    void mutate({ action: 'unbind-bot', botId });
  };

  /** Bound sessions of a bot, resolved to display titles (fallback: raw id). */
  const boundSessionsOf = (botId: string): Array<{ id: string; title: string }> => {
    if (doc === null) return [];
    return Object.entries(doc.sessions)
      .filter(([, bid]) => bid === botId)
      .map(([sid]) => ({
        id: sid,
        title: sessionsById[sid]?.displayTitle ?? sid,
      }));
  };

  const botTypeOf = (bot: Record<string, unknown>): string =>
    typeof bot['type'] === 'string' ? bot['type'] : '';
  const botSecretOf = (bot: Record<string, unknown>): string =>
    typeof bot['secret'] === 'string' ? bot['secret'] : '';
  const botIdOf = (bot: Record<string, unknown>): string =>
    typeof bot['id'] === 'string' ? bot['id'] : '';

  return (
    <div style={{ fontSize: 13, lineHeight: '20px', color: c.labelPrimary }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 2px' }}>Bot 设置</h2>
      <div style={{ color: c.labelSecondary, marginBottom: 14, wordBreak: 'break-all' }}>
        文件：{config?.botFile ?? '~/.lynel-desktop/bot.json'}
      </div>

      {busy && doc === null ? (
        <div style={{ color: c.labelSecondary }}>加载中…</div>
      ) : (
        <>
          {/* ── bot list (one line per bot) ── */}
          <div style={{ fontWeight: 600, margin: '4px 0 8px' }}>
            已注册的 Bot（{doc?.bots.length ?? 0}）
          </div>
          {(doc?.bots.length ?? 0) === 0 ? (
            <div style={{ color: c.labelSecondary, marginBottom: 12 }}>还没有 bot，点下方「添加 Bot」添加第一个。</div>
          ) : (
            doc?.bots.map((bot) => {
              const id = botIdOf(bot);
              const name = typeof bot['name'] === 'string' && bot['name'] !== '' ? bot['name'] : id;
              const type = typeLabel(botTypeOf(bot));
              const secret = botSecretOf(bot);
              const bound = boundSessionsOf(id);
              const boundNames = bound.map((session) => session.title).join('、');
              return (
                <div key={id} style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{name}</span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '1px 8px',
                        borderRadius: 99,
                        border: `1px solid ${c.border}`,
                        color: c.labelSecondary,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {type}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12,
                        color: c.labelSecondary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={
                        `BotId：${id}` +
                        (secret !== '' ? '\nSecret：••••••••' : '') +
                        (bound.length > 0 ? `\n绑定会话（${bound.length}）：\n${boundNames}` : '')
                      }
                    >
                      <code>{id}</code>
                      {secret !== '' && ' · Secret：••••••••'}
                      {bound.length > 0 && ` · 绑定 ${bound.length} 个会话：${boundNames}`}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={bound.length === 0 || busy}
                      title={bound.length === 0 ? '该 bot 未绑定任何会话' : `解绑所有会话：\n${boundNames}`}
                      onClick={() => unbindBot(id)}
                      style={{ flexShrink: 0 }}
                    >
                      解绑
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => removeBot(id)}
                      style={{
                        color: c.error,
                        borderColor: confirmDelete === id ? c.error : undefined,
                        flexShrink: 0,
                      }}
                    >
                      {confirmDelete === id ? '确认删除？' : '删除'}
                    </Button>
                  </div>
                </div>
              );
            })
          )}

          {/* ── add-bot trigger + collapsible form ── */}
          <div style={{ marginTop: 4 }}>
            <Button
              type="button"
              variant={showForm ? 'ghost' : 'primary'}
              size="sm"
              onClick={() => {
                setShowForm((open) => !open);
                setNotice('');
                setError('');
              }}
            >
              {showForm ? '收起' : '＋ 添加 Bot'}
            </Button>
          </div>

          {showForm && (
            <div style={{ ...card, marginTop: 10 }}>
              <div style={fieldRow}>
                <span style={label}>名称 *</span>
                <span style={controlWrap}>
                  <Input style={inputStyle} value={newName} placeholder="例如：企微主号" onChange={(e) => setNewName(e.target.value)} />
                </span>
              </div>
              <div style={fieldRow}>
                <span style={label}>类型 *</span>
                <span style={controlWrap}>
                  <select style={selectStyle} value={newType} onChange={(e) => setNewType(e.target.value)}>
                    {BOT_TYPES.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              <div style={fieldRow}>
                <span style={label}>BotId *</span>
                <span style={controlWrap}>
                  <Input style={inputStyle} value={newBotId} placeholder="唯一标识，用于会话绑定" onChange={(e) => setNewBotId(e.target.value)} />
                </span>
              </div>
              <div style={fieldRow}>
                <span style={label}>Secret</span>
                <span style={controlWrap}>
                  <Input style={inputStyle} type="password" value={newSecret} placeholder="密钥（可选）" onChange={(e) => setNewSecret(e.target.value)} />
                </span>
              </div>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Button type="button" variant="primary" size="md" disabled={busy} onClick={addBot}>
                  添加 Bot
                </Button>
                <Button type="button" variant="ghost" size="md" disabled={busy} onClick={() => setShowForm(false)}>
                  取消
                </Button>
                {notice !== '' && <span style={{ color: c.success, fontSize: 12 }}>{notice}</span>}
              </div>
            </div>
          )}
        </>
      )}

      {error !== '' && (
        <div style={{ color: c.error, marginTop: 10, fontSize: 12 }}>{error}</div>
      )}
    </div>
  );
}
