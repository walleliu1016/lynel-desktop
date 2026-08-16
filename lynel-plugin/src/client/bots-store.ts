/**
 * lynel-plugin — shared bot-document cache.
 *
 * The bind modal, the settings page, and the session-header badge all read
 * `~/.lynel-desktop/bot.json`. This module keeps one in-memory copy with a
 * useSyncExternalStore face; every mutation path (bind/unbind in the modal,
 * add/remove in settings) calls {@link refreshBotDoc} so live UI updates
 * without refetching per render.
 */

import type { LynelBotDoc } from './types';

let doc: LynelBotDoc | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Re-fetch the bot document from the host route and notify subscribers. */
export async function refreshBotDoc(): Promise<LynelBotDoc | null> {
  try {
    const res = await fetch('/lynel/bot.json');
    doc = res.ok ? ((await res.json()) as LynelBotDoc) : null;
  } catch {
    doc = null;
  }
  notify();
  return doc;
}

/** useSyncExternalStore subscribe face. */
export function subscribeBotDoc(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore getSnapshot face. */
export function getBotDocSnapshot(): LynelBotDoc | null {
  return doc;
}

/** Human-readable name for a bot record, falling back to its id. */
export function botNameOf(bot: Record<string, unknown> | undefined): string {
  if (bot === undefined) return '未知 bot';
  const name = bot['name'];
  const id = bot['id'];
  if (typeof name === 'string' && name !== '') return name;
  return typeof id === 'string' ? id : '(未命名 bot)';
}

/** Resolve a bot record by id from the current snapshot. */
export function botById(doc: LynelBotDoc | null, botId: string): Record<string, unknown> | undefined {
  return doc?.bots.find((bot) => String(bot['id']) === botId);
}
