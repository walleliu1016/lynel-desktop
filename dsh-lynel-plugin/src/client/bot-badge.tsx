/**
 * dsh-lynel-plugin — session-header bot badge.
 *
 * Session-scope entry in `conversation.session.header.actions`: when the
 * current session has a bound bot, render a small badge with the bot's name;
 * otherwise render nothing.
 */

import { useSyncExternalStore } from 'react';
import { botById, botNameOf, getBotDocSnapshot, subscribeBotDoc } from './bots-store';
import type { CSSProperties } from 'react';

interface BotBadgeProps {
  /** Framework-injected session id (session-scope standard kit). */
  sessionId: string;
}

const pill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  lineHeight: '16px',
  padding: '2px 8px',
  borderRadius: 99,
  border: '1px solid var(--dsw-alias-border-l1, #2b2e36)',
  background: 'var(--dsw-alias-bg-layer-1, #1b1d22)',
  color: 'var(--dsw-alias-label-primary, #e6e6e6)',
  whiteSpace: 'nowrap',
};

export function BotBadge({ sessionId }: BotBadgeProps): JSX.Element | null {
  const doc = useSyncExternalStore(subscribeBotDoc, getBotDocSnapshot);
  const botId = doc?.sessions[sessionId];
  if (botId === undefined) return null;
  return (
    <span style={pill} title={`已绑定 Bot：${botId}`}>
      <span aria-hidden>🤖</span>
      {botNameOf(botById(doc, botId))}
    </span>
  );
}
