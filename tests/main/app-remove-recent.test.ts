import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 删除最近会话的清理链回归（诊断严重2）。
 *  踩过的坑：app:removeRecentSession 只 filter recents 文件 ——
 *  session 注册表、wecom 绑定（sessionBotMap）、路由兜底全部残留成死指针；
 *  session.remove 的 onRemove 回调（清理链唯一入口）全仓没有调用方。 */

const handlers = new Map<string, (...args: any[]) => any>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn); },
    on: () => {},
    removeHandler: () => {},
  },
  app: { getVersion: () => '0.0.0-test', getPath: () => os.tmpdir(), getName: () => 'lynel' },
  BrowserWindow: class { static getAllWindows() { return []; } },
  dialog: {},
  powerSaveBlocker: {},
  clipboard: { writeText: () => {}, readText: () => '' },
  shell: { showItemInFolder: () => {}, openExternal: async () => {} },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

// store.js 不 mock：WeComChannel 的 routingStore 依赖 electron-store 的 dot 路径语义
// （mappings.<chatId>），平面 KV mock 会让 clearSessionMappings 的持久化清理静默失效。
// 真实 electron-store 落 ~/.lynel-desktop/，与 wecom-binding 测试同模式，测试后自清。

// registerIpcHandlers 开头的三个初始化：真实现会建目录 / 开 sqlite / 初始化 electron-updater
vi.mock('../../src/main/updater/index.js', () => ({ initUpdater: vi.fn() }));
vi.mock('../../src/main/tasks/index.js', () => ({
  initTasks: vi.fn(),
  tasksShutdown: vi.fn(),
  setTaskResultSink: vi.fn(),
}));

import { App } from '../../src/main/app.js';
import * as session from '../../src/main/session.js';

const RECENTS_PATH = path.join(os.homedir(), '.lynel-desktop', 'recent-sessions.json');
const sid = 'purge-test-sid';
let originalRecents = '';

function readRecents(): any[] {
  try { return JSON.parse(fs.readFileSync(RECENTS_PATH, 'utf8')); } catch { return []; }
}
function writeRecents(list: any[]): void {
  fs.mkdirSync(path.dirname(RECENTS_PATH), { recursive: true });
  fs.writeFileSync(RECENTS_PATH, JSON.stringify(list, null, 2), 'utf8');
}

describe('app:removeRecentSession 清理链（session 注册 + wecom 绑定 + recents）', () => {
  let app: App;
  let channel: any;

  beforeAll(() => {
    try { originalRecents = fs.readFileSync(RECENTS_PATH, 'utf8'); } catch { originalRecents = ''; }
    app = new App();
    // onRemove 回调原来注册在 init()（副作用太大跑不了）；移到构造函数后这里天然生效。
    // 若测试失败提示 onRemove 未注册，说明回调又搬回 init 了 —— 清理链会再次断掉。
    channel = (app as any).wecomChannel;
    (app as any).registerIpcHandlers();
  });

  afterAll(() => {
    // 真实文件恢复原状（beforeEach 只增删自己的 sid 条目）
    if (originalRecents) {
      try { fs.writeFileSync(RECENTS_PATH, originalRecents, 'utf8'); } catch {}
    } else {
      writeRecents(readRecents().filter((r) => r.sessionId !== sid));
    }
    // routing 残留兜底清（断言失败时清理链可能没跑完）
    channel.clearSessionBot(sid);
  });

  beforeEach(() => {
    // 造现场：session 注册在表里、wecom 绑定 + 路由兜底都有、recents 有记录
    const s = session.newSession(sid, '/wd-purge');
    s.process = { write: () => {}, kill: () => {} } as any;
    session.register(s);
    channel.setSessionBot(sid, 'bot-purge');
    (channel as any).recordRouting('chat-purge', sid);
    const recents = readRecents().filter((r) => r.sessionId !== sid);
    recents.unshift({
      sessionId: sid, workdir: '/wd-purge', project: 'p', aiTitle: '', firstPrompt: '',
      lastOpenedAt: Date.now(), state: 'idle', botId: 'bot-purge',
    });
    writeRecents(recents);
    (app as any).debouncedSendCloudSessionSnapshot = () => {}; // 500ms 真实 timer 不进测试
  });

  it('删除最近会话：session 注册表、wecom 绑定、路由兜底、recents 全部清掉', async () => {
    const handler = handlers.get('app:removeRecentSession');
    expect(handler).toBeDefined();

    await handler({}, sid);

    // session 注册表：remove 而非只 filter recents —— 否则 onRemove 清理链永不执行
    expect(session.lookup(sid)).toBeUndefined();
    // wecom 绑定：sessionBotMap 残留会让入站消息路由到死会话
    expect(channel.sessionBotMap.has(sid)).toBe(false);
    // 路由兜底：chatIdToSession 残留同理
    expect((channel as any).chatIdToSession.has('chat-purge')).toBe(false);
    expect((channel as any).lastActiveSession.has('chat-purge')).toBe(false);
    // 持久化 routing mapping
    expect((channel as any).resolveBoundSessionId('chat-purge')).toBeUndefined();
    // recents 文件（现行为，防回归）
    expect(readRecents().some((r) => r.sessionId === sid)).toBe(false);
    // 持久化 binding：同 bot 不得残留指向已删会话
    expect((channel as any).getMapping?.('chat-purge')).toBeFalsy();
  });

  it('会话进程仍存活时删除：进程被 kill（不留孤儿 PTY）', async () => {
    const handler = handlers.get('app:removeRecentSession');
    const killed = vi.fn();
    const s = session.lookup(sid)!;
    (s.process as any).kill = killed;

    await handler({}, sid);

    expect(killed).toHaveBeenCalled();
    expect(session.lookup(sid)).toBeUndefined();
  });
});
