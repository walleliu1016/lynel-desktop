import { describe, it, expect, vi, beforeAll } from 'vitest';
import Module from 'node:module';
import type { SessionMeta as JsonlSessionMeta } from '../../src/main/jsonl.js';

// app.ts 顶层 import 了 electron。本机没有网络下载 Electron binary 时，
// 任何路径 require/import('electron') 都会触发 @electron/get 下载并挂死/超时。
// 这里只测纯函数 mergeRecentAgentField，需要三重拦截：
//  1. vi.mock('electron')：拦 ESM 的 `import ... from 'electron'`（app/attention/updater 等被 transform 的源码）。
//  2. vi.mock('electron-store')：electron-store 是 externalized 依赖（不走 vitest transform），
//     其 dist 顶层 `import electron from 'electron'` 原生加载真 electron，需直接 mock 本体。
//  3. 劫持 Module.prototype.require：permission-broker/attention/wecom-channel/updater 顶层
//     调 getLogger() → log.ts createRequire 加载 electron-log → 其顶层 require('electron')，
//     走 CJS 不走 vitest transform，vi.mock 拦不住，需在 require 层拦掉。
// 因此 app.js 必须动态 import（静态 import 会在 require 劫持前求值）。
let mergeRecentAgentField: (raw: JsonlSessionMeta[], recents: { sessionId: string; agent?: string }[]) => JsonlSessionMeta[];

vi.mock('electron', () => ({
  app: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: vi.fn(),
  dialog: {},
  powerSaveBlocker: {},
  clipboard: {},
  shell: {},
  Notification: vi.fn(),
  contextBridge: {},
  ipcRenderer: {},
}));

vi.mock('electron-store', () => {
  return {
    __esModule: true,
    default: class MockElectronStore {
      private data = new Map<string, unknown>();
      get(key: string, def?: unknown) { return this.data.has(key) ? this.data.get(key) : def; }
      set(key: string, val: unknown) { this.data.set(key, val); }
      delete(key: string) { this.data.delete(key); }
    },
  };
});

beforeAll(async () => {
  const origReq = Module.prototype.require;
  Module.prototype.require = function (id: string) {
    if (id === 'electron' || id === 'electron-log/main') {
      throw new Error('electron unavailable in sandbox');
    }
    return origReq.call(this, id);
  };
  try {
    const mod = await import('../../src/main/app.js');
    mergeRecentAgentField = mod.mergeRecentAgentField;
  } finally {
    Module.prototype.require = origReq;
  }
});

describe('mergeRecentAgentField', () => {
  it('recents 带 agent 时合并到 SessionMeta', () => {
    const raw = [{ id: 'sid-1', workdir: '/p', project: 'p', mtime: 1 }] as unknown as JsonlSessionMeta[];
    const recents = [{ sessionId: 'sid-1', workdir: '/p', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle', agent: 'codex' }];
    const out = mergeRecentAgentField(raw, recents);
    expect(out[0].agent).toBe('codex');
  });
  it('recents 无 agent 时不覆盖', () => {
    const raw = [{ id: 'sid-1', workdir: '/p', project: 'p', mtime: 1 }] as unknown as JsonlSessionMeta[];
    const recents = [{ sessionId: 'sid-1', workdir: '/p', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle' }];
    const out = mergeRecentAgentField(raw, recents);
    expect(out[0].agent).toBeUndefined();
  });
  it('raw 已有 agent 且 recents 无 agent 时保留 raw 值', () => {
    const raw = [{ id: 'sid-1', workdir: '/p', project: 'p', mtime: 1, agent: 'omp' }] as unknown as JsonlSessionMeta[];
    const recents = [{ sessionId: 'sid-1', workdir: '/p', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle' }];
    const out = mergeRecentAgentField(raw, recents);
    expect(out[0].agent).toBe('omp');
  });
});
