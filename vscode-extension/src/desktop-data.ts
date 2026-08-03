import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { BotConfig } from './types/bot.js';

export type { BotConfig } from './types/bot.js';

export const LYNEL_DESKTOP_DIR = path.join(os.homedir(), '.lynel-desktop');
export const DESKTOP_SETTINGS_PATH = path.join(LYNEL_DESKTOP_DIR, 'settings.json');
export const RECENT_SESSIONS_PATH = path.join(LYNEL_DESKTOP_DIR, 'recent-sessions.json');

interface DesktopSettings {
  wecomBots?: Record<string, BotConfig>;
  [key: string]: unknown;
}

export interface RecentSessionRecord {
  sessionId: string;
  workdir: string;
  project: string;
  aiTitle: string;
  firstPrompt: string;
  userTitle?: string;
  lastOpenedAt: number;
  state: string;
  botId?: string;
  terminated?: boolean;
}

function readJson<T>(filePath: string): T | undefined {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    }
  } catch { /* ignore */ }
  return undefined;
}

function writeJson(filePath: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* ignore */ }
}

/** 从 Desktop 的 settings.json 读取 wecomBots */
export function readDesktopBots(): Record<string, BotConfig> {
  const settings = readJson<DesktopSettings>(DESKTOP_SETTINGS_PATH);
  return settings?.wecomBots ?? {};
}

/** 把 wecomBots 写回 Desktop 的 settings.json，保留其他字段 */
export function writeDesktopBots(bots: Record<string, BotConfig>): void {
  const settings = readJson<DesktopSettings>(DESKTOP_SETTINGS_PATH) ?? {};
  settings.wecomBots = bots;
  writeJson(DESKTOP_SETTINGS_PATH, settings);
}

/** 读取最近会话列表 */
export function readRecentSessions(): RecentSessionRecord[] {
  const list = readJson<RecentSessionRecord[]>(RECENT_SESSIONS_PATH);
  return Array.isArray(list) ? list : [];
}

/** 写回最近会话列表 */
export function writeRecentSessions(list: RecentSessionRecord[]): void {
  writeJson(RECENT_SESSIONS_PATH, list);
}

/** 添加或更新最近会话记录 */
export async function addRecentSession(record: RecentSessionRecord): Promise<void> {
  const list = readRecentSessions();
  const idx = list.findIndex((r) => r.sessionId === record.sessionId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...record, lastOpenedAt: Date.now() };
  } else {
    list.unshift({ ...record, lastOpenedAt: Date.now() });
  }
  const sorted = list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 30);
  writeRecentSessions(sorted);
}

/** 更新指定会话的 bot 绑定 */
export function updateSessionBotBinding(sessionId: string, botId: string | undefined): boolean {
  const list = readRecentSessions();
  const idx = list.findIndex((r) => r.sessionId === sessionId);
  if (idx < 0) return false;
  if (botId) {
    list[idx].botId = botId;
  } else {
    delete list[idx].botId;
  }
  writeRecentSessions(list);
  return true;
}

/** 获取指定会话的 bot 绑定 */
export function getSessionBotBinding(sessionId: string): string | undefined {
  return readRecentSessions().find((r) => r.sessionId === sessionId)?.botId;
}
