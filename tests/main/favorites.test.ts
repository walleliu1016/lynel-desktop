// tests/main/favorites.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readFavoriteSessions,
  writeFavoriteSessions,
  addFavorite,
  removeFavorite,
  mergeFavoriteTitles,
  type FavoriteSessionRecord,
} from '../../src/main/favorites.js';

// 隔离 electron 相关 import（favorites.ts 若引入 AgentKind 仅类型 import，无运行时依赖）
vi.mock('electron', () => ({ safeStorage: {} }));

function tmpPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-fav-'));
  return path.join(dir, 'favorites.json');
}

const base = { sessionId: 's1', workdir: '/p', project: 'p', firstPrompt: 'hi' } as const;

describe('favorites', () => {
  let f: string;
  beforeEach(() => { f = tmpPath(); });

  it('读取不存在文件返回空数组', () => {
    expect(readFavoriteSessions(f)).toEqual([]);
  });

  it('addFavorite 幂等追加末尾，带 favoritedAt', () => {
    expect(addFavorite({ sessionId: 's1', workdir: '/p', project: 'p' }, f)).toBe(true);
    expect(addFavorite({ sessionId: 's1', workdir: '/p', project: 'p' }, f)).toBe(false);
    expect(addFavorite({ sessionId: 's2', workdir: '/p', project: 'p' }, f)).toBe(true);
    const list = readFavoriteSessions(f);
    expect(list.map((r) => r.sessionId)).toEqual(['s1', 's2']);
    expect(list[0].favoritedAt).toBeGreaterThan(0);
    expect(list[0].favoritedAt).toBeLessThanOrEqual(list[1].favoritedAt);
  });

  it('removeFavorite 过滤并保持顺序', () => {
    addFavorite({ sessionId: 's1', workdir: '/p', project: 'p' }, f);
    addFavorite({ sessionId: 's2', workdir: '/p', project: 'p' }, f);
    removeFavorite('s1', f);
    expect(readFavoriteSessions(f).map((r) => r.sessionId)).toEqual(['s2']);
  });

  it('写损坏 JSON 读取返回空数组不抛异常', () => {
    fs.writeFileSync(f, 'not-json', 'utf8');
    expect(readFavoriteSessions(f)).toEqual([]);
  });

  it('mergeFavoriteTitles 用 recents 最新标题覆盖并保持顺序', () => {
    const favs: FavoriteSessionRecord[] = [
      { ...base, sessionId: 'a', firstPrompt: 'old' },
      { ...base, sessionId: 'b', firstPrompt: 'keep', favoritedAt: 2 },
    ] as FavoriteSessionRecord[];
    const recents = [{ sessionId: 'a', userTitle: 'new-title', agent: 'codex' as any }];
    const merged = mergeFavoriteTitles(favs, recents);
    expect(merged.map((r) => r.sessionId)).toEqual(['a', 'b']);
    expect(merged[0].userTitle).toBe('new-title');
    expect(merged[0].agent).toBe('codex');
    expect(merged[0].firstPrompt).toBe('old'); // recents 无该字段时不覆盖
    expect(merged[1].firstPrompt).toBe('keep');
  });
});
