import { describe, it, expect } from 'vitest';
import type { SessionMeta as JsonlSessionMeta } from '../../src/main/jsonl.js';
import { mergeRecentAgentField, type RecentSessionRecord } from '../../src/main/session-meta.js';

describe('mergeRecentAgentField', () => {
  it('recents 带 agent 时合并到 SessionMeta', () => {
    const raw = [{ id: 'sid-1', workdir: '/p', project: 'p', mtime: 1 }] as unknown as JsonlSessionMeta[];
    const recents: RecentSessionRecord[] = [{ sessionId: 'sid-1', workdir: '/p', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle', agent: 'codex' }];
    const out = mergeRecentAgentField(raw, recents);
    expect(out[0].agent).toBe('codex');
  });
  it('recents 无 agent 时不覆盖', () => {
    const raw = [{ id: 'sid-1', workdir: '/p', project: 'p', mtime: 1 }] as unknown as JsonlSessionMeta[];
    const recents: RecentSessionRecord[] = [{ sessionId: 'sid-1', workdir: '/p', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle' }];
    const out = mergeRecentAgentField(raw, recents);
    expect(out[0].agent).toBeUndefined();
  });
  it('raw 已有 agent 且 recents 无 agent 时保留 raw 值', () => {
    const raw = [{ id: 'sid-1', workdir: '/p', project: 'p', mtime: 1, agent: 'omp' }] as unknown as JsonlSessionMeta[];
    const recents: RecentSessionRecord[] = [{ sessionId: 'sid-1', workdir: '/p', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle' }];
    const out = mergeRecentAgentField(raw, recents);
    expect(out[0].agent).toBe('omp');
  });
});
