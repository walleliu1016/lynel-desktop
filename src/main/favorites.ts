// src/main/favorites.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentKind } from './agents/index.js';

export interface FavoriteSessionRecord {
  sessionId: string;
  workdir: string;
  project: string;
  userTitle?: string;
  aiTitle?: string;
  firstPrompt?: string;
  agent?: AgentKind;
  favoritedAt: number;
}

export const FAVORITES_PATH = path.join(os.homedir(), '.lynel-desktop', 'favorite-sessions.json');

export function readFavoriteSessions(filePath: string = FAVORITES_PATH): FavoriteSessionRecord[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as FavoriteSessionRecord[];
  } catch {
    return []; // 不存在 / 损坏 / 无权限一律空数组，不阻塞主进程
  }
}

export function writeFavoriteSessions(list: FavoriteSessionRecord[], filePath: string = FAVORITES_PATH): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8');
  } catch {
    /* 收藏写入失败仅影响收藏持久化，不阻断主流程 */
  }
}

export function addFavorite(record: Omit<FavoriteSessionRecord, 'favoritedAt'>, filePath: string = FAVORITES_PATH): boolean {
  const list = readFavoriteSessions(filePath);
  if (list.some((r) => r.sessionId === record.sessionId)) return false;
  list.push({ ...record, favoritedAt: Date.now() });
  writeFavoriteSessions(list, filePath);
  return true;
}

export function removeFavorite(sessionId: string, filePath: string = FAVORITES_PATH): void {
  const list = readFavoriteSessions(filePath).filter((r) => r.sessionId !== sessionId);
  writeFavoriteSessions(list, filePath);
}

export function mergeFavoriteTitles(
  favorites: FavoriteSessionRecord[],
  recents: Array<{ sessionId: string; userTitle?: string; aiTitle?: string; firstPrompt?: string; agent?: AgentKind }>,
): FavoriteSessionRecord[] {
  const map = new Map(recents.map((r) => [r.sessionId, r]));
  return favorites.map((fav) => {
    const rec = map.get(fav.sessionId);
    if (!rec) return fav;
    const merged: FavoriteSessionRecord = { ...fav };
    if (rec.userTitle) merged.userTitle = rec.userTitle;
    if (rec.aiTitle) merged.aiTitle = rec.aiTitle;
    if (rec.firstPrompt) merged.firstPrompt = rec.firstPrompt;
    if (rec.agent) merged.agent = rec.agent;
    return merged;
  });
}
