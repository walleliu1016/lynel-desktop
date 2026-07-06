# Ease UI Electron 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `ease-ui` 从 Wails + Go 迁移到 Electron + Node.js + Vue 3，复用现有前端，实现 SSE 与 WeCom 双 channel 输出。

**Architecture:** Electron 主进程承担原 Go 后端职责（session/pty/hookserver/apiproxy/channels），通过 `contextBridge` 暴露 API；Vue 前端复用现有组件，仅把 `useWails` 替换为 `useElectron`。

**Tech Stack:** Electron 33+, Vue 3, Pinia, node-pty, Express, chokidar, bcryptjs, electron-store, electron-builder, TypeScript 5.3+

---

## 文件结构总览

```
ease-ui/
├── package.json                          # 根 package，新增 Electron 脚本/依赖
├── electron-builder.yml                  # 打包配置
├── tsconfig.electron.json                # Electron 主进程 TS 配置
├── electron/
│   ├── main.ts                           # 主进程入口
│   ├── preload.ts                        # contextBridge 暴露 API
│   └── vite.config.ts                    # 开发/生产构建配置
├── src/main/                             # Node.js 后端模块（替代 Go internal/）
│   ├── app.ts                            # 主 App 类，ipcMain 路由
│   ├── auth.ts                           # bcrypt 密码验证
│   ├── store.ts                          # settings + instance JSON 持久化
│   ├── events.ts                         # EventEmitter 总线
│   ├── log.ts                            # 日志（electron-log）
│   ├── jsonl.ts                          # 扫描/监听 ~/.claude/projects
│   ├── session.ts                        # 会话状态机
│   ├── pty.ts                            # node-pty 封装
│   ├── process.ts                        # 子进程工具
│   ├── hookserver.ts                     # Express HTTP server
│   ├── apiproxy.ts                       # Claude API 代理 + channel 分发
│   └── channels/
│       ├── channel.ts                    # OutputChannel 接口
│       ├── registry.ts                   # ChannelDispatcher
│       ├── sse-channel.ts                # SSE 输出
│       └── wecom-channel.ts              # 企业微信输出
├── frontend/                             # 现有 Vue 前端
│   └── src/composables/
│       ├── useWails.ts                   # 删除
│       └── useElectron.ts                # 新增
└── tests/main/                           # 主进程单元测试（vitest + jsdom/node）
```

---

## Milestone 0: 项目初始化与依赖

**目标:** Electron 能编译运行，Vue 前端能被主进程加载。

### Task 0.1: 初始化根 package.json

**Files:**
- Create: `package.json`

- [ ] **Step 1: 编写根 package.json**

```json
{
  "name": "ease-ui",
  "version": "0.0.1",
  "private": true,
  "main": "dist-electron/main.js",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run dev:frontend\" \"npm run dev:electron\"",
    "dev:frontend": "cd frontend && vite",
    "dev:electron": "tsc -p tsconfig.electron.json --watch",
    "build": "npm run build:frontend && npm run build:electron",
    "build:frontend": "cd frontend && vue-tsc --noEmit && vite build",
    "build:electron": "tsc -p tsconfig.electron.json",
    "dist": "electron-builder",
    "dist:win": "electron-builder --win",
    "dist:mac": "electron-builder --mac",
    "dist:linux": "electron-builder --linux",
    "test": "vitest run",
    "test:main": "vitest run tests/main"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "concurrently": "^9.0.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "typescript": "^5.3.3",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "chokidar": "^4.0.0",
    "electron-log": "^5.0.0",
    "electron-store": "^10.0.0",
    "express": "^4.21.0",
    "node-pty": "^1.0.0",
    "undici": "^7.24.6"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `cd G:/work/ease-ui && npm install`
Expected: `node_modules` 创建，无报错。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 初始化 Electron 根 package 与依赖"
```

### Task 0.2: Electron TypeScript 配置

**Files:**
- Create: `tsconfig.electron.json`

- [ ] **Step 1: 编写 tsconfig.electron.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist-electron",
    "rootDir": "electron",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["electron/**/*", "src/main/**/*"],
  "exclude": ["node_modules", "frontend", "dist", "dist-electron"]
}
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.electron.json
git commit -m "chore: 添加 Electron 主进程 TS 配置"
```

### Task 0.3: 主进程入口与窗口

**Files:**
- Create: `electron/main.ts`
- Create: `electron/preload.ts`

- [ ] **Step 1: 编写 electron/main.ts**

```ts
import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#0A0A0A',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../build/windows/trayicon.ico'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Ease UI');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示', click: () => mainWindow?.show() },
    { label: '退出', click: () => app.quit() },
  ]));
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });
}
```

- [ ] **Step 2: 编写 electron/preload.ts**

```ts
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const api = {
  isInitialized: () => ipcRenderer.invoke('app:isInitialized'),
  verify: (pw: string) => ipcRenderer.invoke('app:verify', pw),
  lockoutState: () => ipcRenderer.invoke('app:lockoutState'),
  setPassword: (pw: string) => ipcRenderer.invoke('app:setPassword', pw),
  clearPassword: () => ipcRenderer.invoke('app:clearPassword'),
  listSessions: () => ipcRenderer.invoke('app:listSessions'),
  createSession: (workDir: string, prompt: string) => ipcRenderer.invoke('app:createSession', workDir, prompt),
  sendMessage: (id: string, prompt: string) => ipcRenderer.invoke('app:sendMessage', id, prompt),
  closeSession: (id: string) => ipcRenderer.invoke('app:closeSession', id),
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  updateSettings: (cfg: any) => ipcRenderer.invoke('app:updateSettings', cfg),
  getHooksConfig: () => ipcRenderer.invoke('app:getHooksConfig'),
  saveHooksConfig: (cfg: any) => ipcRenderer.invoke('app:saveHooksConfig', cfg),
  getSessionMessages: (id: string, workDir: string, offset: number, limit: number) =>
    ipcRenderer.invoke('app:getSessionMessages', id, workDir, offset, limit),
  getToolExecutions: (id: string, workDir: string) =>
    ipcRenderer.invoke('app:getToolExecutions', id, workDir),
  pickDirectory: () => ipcRenderer.invoke('app:pickDirectory'),
  getHookServerPort: () => ipcRenderer.invoke('app:getHookServerPort'),
  checkAndFixHooks: () => ipcRenderer.invoke('app:checkAndFixHooks'),
  getSessionStates: () => ipcRenderer.invoke('app:getSessionStates'),
  adoptSession: (id: string, workDir: string) => ipcRenderer.invoke('app:adoptSession', id, workDir),
  openSessionTerminal: (id: string, workDir: string) => ipcRenderer.invoke('app:openSessionTerminal', id, workDir),
  openSessionTerminalSized: (id: string, workDir: string, cols: number, rows: number) =>
    ipcRenderer.invoke('app:openSessionTerminalSized', id, workDir, cols, rows),
  writeTerminalInput: (id: string, data: string) => ipcRenderer.invoke('app:writeTerminalInput', id, data),
  resizeTerminal: (id: string, cols: number, rows: number) => ipcRenderer.invoke('app:resizeTerminal', id, cols, rows),
  getProvidersConfig: () => ipcRenderer.invoke('app:getProvidersConfig'),
  saveProvidersConfig: (cfg: any) => ipcRenderer.invoke('app:saveProvidersConfig', cfg),
  applyActiveProvider: () => ipcRenderer.invoke('app:applyActiveProvider'),

  eventsOn: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_event: IpcRendererEvent, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  windowMinimise: () => ipcRenderer.send('window:minimise'),
  windowMaximise: () => ipcRenderer.send('window:maximise'),
  windowUnmaximise: () => ipcRenderer.send('window:unmaximise'),
  windowToggleMaximise: () => ipcRenderer.send('window:toggleMaximise'),
  windowIsMaximised: () => ipcRenderer.invoke('window:isMaximised'),
  windowShow: () => ipcRenderer.send('window:show'),
  windowHide: () => ipcRenderer.send('window:hide'),
  windowSetSize: (width: number, height: number) => ipcRenderer.send('window:setSize', width, height),
  windowSetMinSize: (width: number, height: number) => ipcRenderer.send('window:setMinSize', width, height),
  windowSetMaxSize: (width: number, height: number) => ipcRenderer.send('window:setMaxSize', width, height),
  windowCenter: () => ipcRenderer.send('window:center'),
  windowQuit: () => ipcRenderer.send('window:quit'),
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
```

- [ ] **Step 3: 编译验证**

Run: `cd G:/work/ease-ui && npm run build:electron`
Expected: `dist-electron/main.js` 和 `dist-electron/preload.js` 生成。

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: Electron 主进程入口与 preload API"
```

---

## Milestone 1: 基础后端模块

**目标:** 把与 UI 无关的基础模块（auth/store/events/log/jsonl）迁移到 Node.js，并通过 IPC 暴露。

### Task 1.1: 日志模块

**Files:**
- Create: `src/main/log.ts`
- Create: `tests/main/log.test.ts`

- [ ] **Step 1: 编写测试**

```ts
// tests/main/log.test.ts
import { describe, it, expect } from 'vitest';
import { getLogger } from '../../src/main/log.js';

describe('log', () => {
  it('returns a logger with info/error methods', () => {
    const log = getLogger();
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd G:/work/ease-ui && npx vitest run tests/main/log.test.ts`
Expected: FAIL `getLogger is not defined`

- [ ] **Step 3: 实现 log.ts**

```ts
// src/main/log.ts
import log from 'electron-log/main';

log.initialize();

export function getLogger() {
  return log;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd G:/work/ease-ui && npx vitest run tests/main/log.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/log.ts tests/main/log.test.ts
git commit -m "feat: Electron 日志模块"
```

### Task 1.2: 事件总线

**Files:**
- Create: `src/main/events.ts`
- Create: `tests/main/events.test.ts`

- [ ] **Step 1: 编写测试**

```ts
// tests/main/events.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getBus } from '../../src/main/events.js';

describe('events bus', () => {
  it('emits and listens', () => {
    const bus = getBus();
    const handler = vi.fn();
    bus.on('test', handler);
    bus.emit('test', 'payload');
    expect(handler).toHaveBeenCalledWith('payload');
  });
});
```

- [ ] **Step 2: 实现 events.ts**

```ts
// src/main/events.ts
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();

export function getBus(): EventEmitter {
  return bus;
}
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/main/events.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/events.ts tests/main/events.test.ts
git commit -m "feat: 主进程事件总线"
```

### Task 1.3: 本地存储（settings + instance）

**Files:**
- Create: `src/main/store.ts`
- Create: `tests/main/store.test.ts`

- [ ] **Step 1: 编写测试**

```ts
// tests/main/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getStore, Store } from '../../src/main/store.js';

let store: Store;

beforeEach(() => {
  store = getStore('test');
});

describe('store', () => {
  it('sets and gets nested settings', () => {
    store.set('channels.wecom.enabled', true);
    expect(store.get('channels.wecom.enabled')).toBe(true);
  });

  it('returns default when key missing', () => {
    expect(store.get('missing', 'default')).toBe('default');
  });
});
```

- [ ] **Step 2: 实现 store.ts**

```ts
// src/main/store.ts
import ElectronStore from 'electron-store';

const instances = new Map<string, ElectronStore>();

export type Store = ElectronStore;

export function getStore(name: string = 'default'): Store {
  if (!instances.has(name)) {
    instances.set(name, new ElectronStore({ name }));
  }
  return instances.get(name)!;
}
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/main/store.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/store.ts tests/main/store.test.ts
git commit -m "feat: 本地 settings/instance 存储"
```

### Task 1.4: 认证模块

**Files:**
- Create: `src/main/auth.ts`
- Create: `tests/main/auth.test.ts`

- [ ] **Step 1: 编写测试**

```ts
// tests/main/auth.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, isInitialized } from '../../src/main/auth.js';

describe('auth', () => {
  it('hashes and verifies password', async () => {
    const hash = await hashPassword('secret');
    expect(await verifyPassword(hash, 'secret')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('isInitialized false when no hash', () => {
    expect(isInitialized('')).toBe(false);
    expect(isInitialized('$2a$10$xxx')).toBe(true);
  });
});
```

- [ ] **Step 2: 实现 auth.ts**

```ts
// src/main/auth.ts
import bcrypt from 'bcryptjs';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export function isInitialized(hash: string): boolean {
  return !!hash;
}
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/main/auth.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/auth.ts tests/main/auth.test.ts
git commit -m "feat: bcrypt 认证模块"
```

### Task 1.5: jsonl 扫描与监听

**Files:**
- Create: `src/main/jsonl.ts`
- Create: `tests/main/jsonl.test.ts`

- [ ] **Step 1: 编写 jsonl.ts**

```ts
// src/main/jsonl.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';

export interface SessionMeta {
  id: string;
  workDir: string;
  path: string;
  updatedAt: number;
}

let rootDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'projects');

export function setRoot(dir: string): void {
  rootDir = dir;
}

export function getRoot(): string {
  return rootDir;
}

function encodeProjectDirName(workDir: string): string {
  return encodeURIComponent(workDir).replace(/%/g, '_');
}

export function getSessionJsonlPath(sessionId: string, workDir: string): string {
  return path.join(rootDir, encodeProjectDirName(workDir), `${sessionId}.jsonl`);
}

export async function scanAll(): Promise<SessionMeta[]> {
  const results: SessionMeta[] = [];
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(rootDir, entry.name);
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(dirPath, file);
        const stat = await fs.stat(filePath);
        results.push({
          id: file.replace('.jsonl', ''),
          workDir: decodeURIComponent(entry.name.replace(/_/g, '%')),
          path: filePath,
          updatedAt: stat.mtimeMs,
        });
      }
    }
  } catch (err) {
    // root may not exist
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function watchProjects(onChange: () => void): () => void {
  const watcher = chokidar.watch(path.join(rootDir, '**/*.jsonl'), {
    ignoreInitial: true,
    persistent: true,
  });
  let timeout: NodeJS.Timeout | null = null;
  const emit = () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(onChange, 500);
  };
  watcher.on('add', emit).on('change', emit).on('unlink', emit);
  return () => watcher.close();
}
```

- [ ] **Step 2: 运行测试**

```ts
// tests/main/jsonl.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setRoot, scanAll, getSessionJsonlPath, watchProjects } from '../../src/main/jsonl.js';

describe('jsonl', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ease-jsonl-${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, 'work_a'), { recursive: true });
    setRoot(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('scans sessions', async () => {
    const p = getSessionJsonlPath('sess-1', '/work_a');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, '{}\n');
    const list = await scanAll();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('sess-1');
  });

  it('watches for changes', async () => {
    return new Promise<void>((resolve) => {
      const unwatch = watchProjects(() => {
        unwatch();
        resolve();
      });
      setTimeout(async () => {
        const p = getSessionJsonlPath('sess-watch', '/work_a');
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, '{}\n');
      }, 100);
    });
  });
});
```

Run: `npx vitest run tests/main/jsonl.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/jsonl.ts tests/main/jsonl.test.ts
git commit -m "feat: jsonl 扫描与监听"
```

---

## Milestone 2: 会话与 PTY

**目标:** 实现 `node-pty` 驱动的 session 管理，支持创建、恢复、输入、关闭。

### Task 2.1: PTY 封装

**Files:**
- Create: `src/main/pty.ts`
- Create: `tests/main/pty.test.ts`

- [ ] **Step 1: 实现 pty.ts**

```ts
// src/main/pty.ts
import * as pty from 'node-pty';
import os from 'node:os';

export enum PtyMode {
  Auto = 'auto',
  New = 'new',
  Resume = 'resume',
}

export interface PtySize {
  cols: number;
  rows: number;
}

export interface PtyProcess {
  pid: number;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (code: number) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
}

export function start(
  cwd: string,
  sessionId: string,
  bin: string,
  mode: PtyMode,
  env: Record<string, string> = {},
  size: PtySize = { cols: 80, rows: 24 },
): PtyProcess {
  const shell = os.platform() === 'win32' ? 'cmd.exe' : bin;
  const args: string[] = [];

  if (mode === PtyMode.New && sessionId) {
    args.push('--session-id', sessionId);
  } else if (mode === PtyMode.Resume && sessionId) {
    args.push('--resume', sessionId);
  }

  // For non-Windows, node-pty spawns the binary directly.
  // For Windows we rely on cmd.exe wrapper for compatibility.
  const proc = pty.spawn(shell, mode === PtyMode.Auto || os.platform() !== 'win32' ? [bin, ...args] : ['/c', bin, ...args], {
    name: 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd,
    env: { ...process.env, ...env } as { [key: string]: string },
  });

  return {
    pid: proc.pid,
    onData: (cb) => proc.onData(cb),
    onExit: (cb) => proc.onExit(({ exitCode }) => cb(exitCode ?? 0)),
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: (signal) => proc.kill(signal),
  };
}
```

- [ ] **Step 2: 编写测试**

```ts
// tests/main/pty.test.ts
import { describe, it, expect } from 'vitest';
import { start, PtyMode } from '../../src/main/pty.js';

describe('pty', () => {
  it('spawns echo and exits', async () => {
    const proc = start(process.cwd(), '', process.platform === 'win32' ? 'echo' : '/bin/echo', PtyMode.Auto, {}, { cols: 80, rows: 24 });
    expect(proc.pid).toBeGreaterThan(0);
    return new Promise<void>((resolve) => {
      proc.onExit(() => resolve());
      setTimeout(() => proc.kill(), 500);
    });
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/main/pty.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/pty.ts tests/main/pty.test.ts
git commit -m "feat: node-pty 封装"
```

### Task 2.2: Session 状态机

**Files:**
- Create: `src/main/session.ts`
- Create: `tests/main/session.test.ts`

- [ ] **Step 1: 实现 session.ts**

```ts
// src/main/session.ts
import { PtyProcess, PtySize } from './pty.js';

export interface Session {
  id: string;
  workDir: string;
  state: 'idle' | 'running' | 'awaiting_permission' | 'done';
  process: PtyProcess | null;
  lastHookAt: number;
}

const sessions = new Map<string, Session>();

export function newSession(id: string, workDir: string): Session {
  return {
    id,
    workDir,
    state: 'idle',
    process: null,
    lastHookAt: 0,
  };
}

export function register(session: Session): void {
  sessions.set(session.id, session);
}

export function lookup(id: string): Session | undefined {
  return sessions.get(id);
}

export function remove(id: string): void {
  sessions.delete(id);
}

export function list(): Session[] {
  return Array.from(sessions.values());
}

export function setProcess(id: string, proc: PtyProcess): void {
  const s = sessions.get(id);
  if (s) {
    s.process = proc;
    s.state = 'running';
  }
}

export function send(id: string, prompt: string): void {
  const s = sessions.get(id);
  if (!s || !s.process) throw new Error(`session ${id} not found or no process`);
  const normalized = /[\r\n]$/.test(prompt) ? prompt : prompt + '\r';
  s.process.write(normalized);
}

export function writeInput(id: string, data: string): void {
  const s = sessions.get(id);
  if (!s || !s.process) throw new Error(`session ${id} not found or no process`);
  s.process.write(data);
}

export function resize(id: string, cols: number, rows: number): void {
  const s = sessions.get(id);
  if (s?.process) s.process.resize(cols, rows);
}

export function close(id: string, signal?: string): void {
  const s = sessions.get(id);
  if (s?.process) {
    s.process.kill(signal);
    s.process = null;
    s.state = 'done';
  }
}
```

- [ ] **Step 2: 运行测试**

```ts
// tests/main/session.test.ts
import { describe, it, expect } from 'vitest';
import { newSession, register, lookup, send } from '../../src/main/session.js';

describe('session', () => {
  it('registers and lookups session', () => {
    const s = newSession('s1', '/wd');
    register(s);
    expect(lookup('s1')?.workDir).toBe('/wd');
  });

  it('send normalizes prompt with carriage return', () => {
    const s = newSession('s2', '/wd');
    let written = '';
    s.process = {
      write: (d) => { written = d; },
    } as any;
    send('s2', 'hello');
    expect(written).toBe('hello\r');
  });
});
```

Run: `npx vitest run tests/main/session.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/session.ts tests/main/session.test.ts
git commit -m "feat: 会话状态机"
```

---

## Milestone 3: HookServer

**目标:** 用 Express 实现本地 HTTP server，接收 Claude hooks，暴露 `/api/send` 等端点。

### Task 3.1: HookServer 核心

**Files:**
- Create: `src/main/hookserver.ts`
- Create: `tests/main/hookserver.test.ts`

- [ ] **Step 1: 实现 hookserver.ts**

```ts
// src/main/hookserver.ts
import express, { Request, Response } from 'express';
import http from 'node:http';

export interface HookEvent {
  hook_event_name?: string;
  type?: string;
  session_id?: string;
  request?: any;
  tool?: string;
}

export type SendHandler = (sessionId: string, prompt: string) => Promise<{ ok: boolean; error?: string }>;
export type EventHandler = (evt: HookEvent) => void;
export type PermissionHandler = (evt: HookEvent) => Promise<{ id: string; allowed: boolean }>;

export class HookServer {
  private app = express();
  private server: http.Server | null = null;
  private port = 0;
  private onSendHandler: SendHandler | null = null;
  private onEventHandler: EventHandler | null = null;
  private onPermissionHandler: PermissionHandler | null = null;
  private lastSeenMap = new Map<string, number>();

  constructor() {
    this.app.use(express.json());
    this.app.post('/hook', (req, res) => this.handleHook(req, res));
    this.app.post('/api/send', (req, res) => this.handleSend(req, res));
  }

  onSend(handler: SendHandler): void {
    this.onSendHandler = handler;
  }

  onEvent(handler: EventHandler): void {
    this.onEventHandler = handler;
  }

  onPermissionRequest(handler: PermissionHandler): void {
    this.onPermissionHandler = handler;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(this.port);
      });
      this.server.once('error', reject);
    });
  }

  getPort(): number {
    return this.port;
  }

  url(): string {
    return `http://127.0.0.1:${this.port}/hook`;
  }

  lastSeen(sessionId: string): number {
    return this.lastSeenMap.get(sessionId) ?? 0;
  }

  private handleHook(req: Request, res: Response): void {
    const evt = req.body as HookEvent;
    const name = evt.hook_event_name ?? evt.type ?? 'unknown';
    const sid = evt.session_id ?? '';
    if (sid) this.lastSeenMap.set(sid, Date.now());

    if (name === 'PermissionRequest' && this.onPermissionHandler) {
      this.onPermissionHandler(evt).then((result) => {
        res.json({ id: result.id, decision: result.allowed ? 'allow' : 'deny' });
      });
      return;
    }

    if (this.onEventHandler) this.onEventHandler(evt);
    res.json({ ok: true });
  }

  private async handleSend(req: Request, res: Response): Promise<void> {
    const { session_id, prompt } = req.body;
    if (!session_id || typeof prompt !== 'string') {
      res.status(400).json({ ok: false, error: 'session_id and prompt required' });
      return;
    }
    if (!this.onSendHandler) {
      res.status(503).json({ ok: false, error: 'send handler not ready' });
      return;
    }
    const result = await this.onSendHandler(session_id, prompt);
    res.status(result.ok ? 200 : 500).json(result);
  }
}
```

- [ ] **Step 2: 运行测试**

```ts
// tests/main/hookserver.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HookServer } from '../../src/main/hookserver.js';

describe('hookserver', () => {
  let server: HookServer;

  beforeEach(async () => {
    server = new HookServer();
    await server.start();
  });

  afterEach(() => {
    // server.close() if implemented
  });

  it('starts on random port', () => {
    expect(server.getPort()).toBeGreaterThan(0);
  });

  it('receives hook event', async () => {
    const events: any[] = [];
    server.onEvent((e) => events.push(e));
    const res = await fetch(server.url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1' }),
    });
    expect(res.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].session_id).toBe('s1');
  });
});
```

Run: `npx vitest run tests/main/hookserver.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/hookserver.ts tests/main/hookserver.test.ts
git commit -m "feat: HookServer Express 实现"
```

---

## Milestone 4: API Proxy 与 Channel Dispatcher

**目标:** 拦截 Claude API 流量，解析阶段数据，分发给 SSE 和 WeCom channel。

### Task 4.1: Channel 接口与 Dispatcher

**Files:**
- Create: `src/main/channels/channel.ts`
- Create: `src/main/channels/registry.ts`
- Create: `tests/main/channels/registry.test.ts`

- [ ] **Step 1: 实现 channel.ts**

```ts
// src/main/channels/channel.ts
export interface ProxyStageEvent {
  seq: number;
  turn: number;
  sessionId: string;
  workDir: string;
  kind: 'prompt' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
  payload: unknown;
  timestamp: number;
}

export interface OutputChannel {
  readonly id: string;
  readonly name: string;
  isEnabled(): boolean;
  send(event: ProxyStageEvent): Promise<void> | void;
  close?(): Promise<void> | void;
}
```

- [ ] **Step 2: 实现 registry.ts**

```ts
// src/main/channels/registry.ts
import { OutputChannel, ProxyStageEvent } from './channel.js';

export class ChannelDispatcher {
  private channels = new Map<string, OutputChannel>();

  register(channel: OutputChannel): void {
    this.channels.set(channel.id, channel);
  }

  unregister(id: string): void {
    this.channels.delete(id);
  }

  async dispatch(event: ProxyStageEvent): Promise<void> {
    for (const channel of this.channels.values()) {
      if (!channel.isEnabled()) continue;
      try {
        await channel.send(event);
      } catch (err) {
        console.error(`[channel ${channel.id}] dispatch failed:`, err);
      }
    }
  }

  list(): OutputChannel[] {
    return Array.from(this.channels.values());
  }
}
```

- [ ] **Step 3: 运行测试**

```ts
// tests/main/channels/registry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ChannelDispatcher } from '../../../src/main/channels/registry.js';
import { OutputChannel, ProxyStageEvent } from '../../../src/main/channels/channel.js';

describe('ChannelDispatcher', () => {
  it('dispatches to enabled channels', async () => {
    const dispatcher = new ChannelDispatcher();
    const channel: OutputChannel = {
      id: 'test',
      name: 'Test',
      isEnabled: () => true,
      send: vi.fn(),
    };
    dispatcher.register(channel);
    const event: ProxyStageEvent = {
      seq: 1, turn: 1, sessionId: 's1', workDir: '/wd',
      kind: 'text', payload: { content: 'hi' }, timestamp: Date.now(),
    };
    await dispatcher.dispatch(event);
    expect(channel.send).toHaveBeenCalledWith(event);
  });
});
```

Run: `npx vitest run tests/main/channels/registry.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/channels/channel.ts src/main/channels/registry.ts tests/main/channels/registry.test.ts
git commit -m "feat: Channel Dispatcher 抽象"
```

### Task 4.2: SSE Channel

**Files:**
- Create: `src/main/channels/sse-channel.ts`
- Modify: `src/main/hookserver.ts`（增加 SSE 端点）

- [ ] **Step 1: 实现 sse-channel.ts**

```ts
// src/main/channels/sse-channel.ts
import { OutputChannel, ProxyStageEvent } from './channel.js';
import { Response } from 'express';

export class SSEChannel implements OutputChannel {
  readonly id = 'sse';
  readonly name = 'HTTP SSE';
  private enabled = true;
  private clients = new Map<string, Response[]>();

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  subscribe(sessionId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const list = this.clients.get(sessionId) ?? [];
    list.push(res);
    this.clients.set(sessionId, list);
    res.on('close', () => this.unsubscribe(sessionId, res));
  }

  private unsubscribe(sessionId: string, res: Response): void {
    const list = this.clients.get(sessionId) ?? [];
    this.clients.set(sessionId, list.filter((r) => r !== res));
  }

  send(event: ProxyStageEvent): void {
    const list = this.clients.get(event.sessionId) ?? [];
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of list) {
      res.write(data);
    }
  }
}
```

- [ ] **Step 2: 在 hookserver.ts 中注册 SSE 路由**

在 `src/main/hookserver.ts` 构造函数中增加：

```ts
this.app.get('/api/sessions/:id/calls/stream', (req, res) => {
  if (this.sseChannel) this.sseChannel.subscribe(req.params.id, res);
});
```

需要把 `sseChannel` 作为可选依赖注入。

- [ ] **Step 3: Commit**

```bash
git add src/main/channels/sse-channel.ts src/main/hookserver.ts
git commit -m "feat: SSE channel 输出"
```

### Task 4.3: API Proxy

**Files:**
- Create: `src/main/apiproxy.ts`

- [ ] **Step 1: 实现 apiproxy.ts**

```ts
// src/main/apiproxy.ts
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { ChannelDispatcher } from './channels/registry.js';
import { ProxyStageEvent } from './channels/channel.js';

export interface Proxy {
  port: number;
  setSessionID(id: string): void;
  close(): void;
}

let seqCounter = 0;
function nextSeq(): number {
  return ++seqCounter;
}

export function newCallID(): string {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const proxyStore = new Map<string, { sessionId: string; workDir: string }>();

export function resolveProxySession(token: string): { sessionId: string; workDir: string } | undefined {
  return proxyStore.get(token);
}

export function startProxy(
  workDir: string,
  token: string,
  dispatcher: ChannelDispatcher,
): Promise<Proxy> {
  proxyStore.set(token, { sessionId: token, workDir });
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Forward to upstream Anthropic API
      const target = new URL(req.url || '/', 'https://api.anthropic.com');
      const options: https.RequestOptions = {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: req.method,
        headers: { ...req.headers, host: target.hostname },
      };

      const proxyReq = https.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      });

      req.pipe(proxyReq);
      proxyReq.on('error', (err) => {
        console.error('[apiproxy] upstream error:', err);
        res.statusCode = 502;
        res.end();
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        setSessionID: (id: string) => {
          const entry = proxyStore.get(token);
          if (entry) {
            proxyStore.set(token, { ...entry, sessionId: id });
          }
        },
        close: () => server.close(),
      });
    });

    server.once('error', reject);
  });
}

export function emitStage(
  dispatcher: ChannelDispatcher,
  sessionId: string,
  workDir: string,
  kind: ProxyStageEvent['kind'],
  payload: unknown,
  turn = 1,
): void {
  const event: ProxyStageEvent = {
    seq: nextSeq(),
    turn,
    sessionId,
    workDir,
    kind,
    payload,
    timestamp: Date.now(),
  };
  dispatcher.dispatch(event).catch((err) => console.error('[apiproxy] dispatch error:', err));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/apiproxy.ts
git commit -m "feat: API Proxy 基础转发框架"
```

### Task 4.4: API Proxy 请求/响应解析

**Files:**
- Modify: `src/main/apiproxy.ts`

- [ ] **Step 1: 捕获请求体并提取 prompt**

在 `server.createServer` 回调中，于 `req.pipe(proxyReq)` 之前增加：

```ts
let requestBody = '';
req.on('data', (chunk) => { requestBody += chunk; });
req.on('end', () => {
  try {
    const json = JSON.parse(requestBody);
    const prompt = json.messages?.[json.messages.length - 1]?.content;
    if (prompt) {
      emitStage(dispatcher, resolveProxySession(token)?.sessionId ?? token, workDir, 'prompt', { prompt }, 1);
    }
  } catch {
    // ignore non-json bodies
  }
});
```

- [ ] **Step 2: 捕获响应 SSE 并提取 text/tool_use**

在 `proxyReq` 回调中，于 `proxyRes.pipe(res)` 之前增加：

```ts
let responseBody = '';
proxyRes.on('data', (chunk: Buffer) => { responseBody += chunk.toString(); });
proxyRes.on('end', () => {
  const lines = responseBody.split('\n').filter((l) => l.startsWith('data: '));
  for (const line of lines) {
    const data = line.slice(6);
    if (data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.delta;
      if (delta?.text) {
        emitStage(dispatcher, resolveProxySession(token)?.sessionId ?? token, workDir, 'text', { text: delta.text }, 1);
      }
      if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
        emitStage(dispatcher, resolveProxySession(token)?.sessionId ?? token, workDir, 'tool_use', parsed.content_block, 1);
      }
    } catch {
      // ignore parse errors
    }
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add src/main/apiproxy.ts
git commit -m "feat: API Proxy 解析 prompt/text/tool_use 阶段"
```

---

## Milestone 5: WeCom Channel

**目标:** 集成 `wecom-openclaw-plugin`，把关键事件转发到企业微信。

### Task 5.1: 安装企微插件

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

Run: `cd G:/work/ease-ui && npm install @wecom/wecom-openclaw-plugin`
Expected: `node_modules/@wecom/wecom-openclaw-plugin` 存在。

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 安装 wecom-openclaw-plugin"
```

### Task 5.2: WeCom Channel 实现

**Files:**
- Create: `src/main/channels/wecom-channel.ts`

- [ ] **Step 1: 实现 wecom-channel.ts**

```ts
// src/main/channels/wecom-channel.ts
import { OutputChannel, ProxyStageEvent } from './channel.js';

export interface WeComChannelConfig {
  enabled: boolean;
  botId?: string;
  secret?: string;
  agent?: {
    corpId: string;
    corpSecret: string;
    agentId: number;
  };
}

export class WeComChannel implements OutputChannel {
  readonly id = 'wecom';
  readonly name = 'WeCom';
  private cfg: WeComChannelConfig;

  constructor(cfg: WeComChannelConfig) {
    this.cfg = cfg;
  }

  isEnabled(): boolean {
    return this.cfg.enabled && (!!this.cfg.botId || !!this.cfg.agent);
  }

  updateConfig(cfg: WeComChannelConfig): void {
    this.cfg = cfg;
  }

  async send(event: ProxyStageEvent): Promise<void> {
    if (!this.isEnabled()) return;

    const humanEvents = ['PermissionRequest', 'tool_result', 'SessionEnd', 'error'];
    const payload = event.payload as any;
    const eventName = payload?.name ?? event.kind;
    if (!humanEvents.includes(eventName) && event.kind !== 'error') return;

    const content = this.formatMessage(event);
    if (!content) return;

    // Placeholder: actual send via wecom-openclaw-plugin will be wired in Task 5.3
    console.log('[wecom-channel] would send:', content);
  }

  private formatMessage(event: ProxyStageEvent): string {
    switch (event.kind) {
      case 'PermissionRequest':
        return `🔒 权限请求: ${(event.payload as any)?.tool || 'unknown'}`;
      case 'tool_result':
        return `🛠️ 工具结果: ${(event.payload as any)?.name || 'unknown'}`;
      case 'error':
        return `❌ 错误: ${(event.payload as any)?.message || 'unknown'}`;
      default:
        return `📌 ${event.kind} (session ${event.sessionId})`;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/channels/wecom-channel.ts
git commit -m "feat: WeCom channel 框架"
```

### Task 5.3: 接入 wecom-openclaw-plugin 发送能力

**Files:**
- Modify: `src/main/channels/wecom-channel.ts`

- [ ] **Step 1: 导入插件发送函数**

在文件顶部增加：

```ts
import { sendWeComMessage } from '@wecom/wecom-openclaw-plugin/dist/wecom-outbound.js';
```

若运行时该路径不存在，使用动态 require 兜底：

```ts
let sendWeComMessage: any;
try {
  ({ sendWeComMessage } = await import('@wecom/wecom-openclaw-plugin/dist/wecom-outbound.js'));
} catch {
  const plugin = await import('@wecom/wecom-openclaw-plugin');
  sendWeComMessage = plugin.sendWeComMessage || plugin.default?.sendWeComMessage;
}
```

- [ ] **Step 2: 替换 send 中的 console.log**

```ts
await sendWeComMessage({
  to: event.sessionId,
  content,
  accountId: 'default',
});
```

- [ ] **Step 3: Commit**

```bash
git add src/main/channels/wecom-channel.ts
git commit -m "feat: WeCom channel 接入插件发送能力"
```

---

## Milestone 6: 主 App 与 IPC 路由

**目标:** 把前面模块组装成 `src/main/app.ts`，并注册所有 `ipcMain` 处理器。

### Task 6.1: App 类

**Files:**
- Create: `src/main/app.ts`
- Modify: `electron/main.ts`（实例化 App）

- [ ] **Step 1: 实现 app.ts 骨架**

```ts
// src/main/app.ts
import { ipcMain, BrowserWindow, dialog } from 'electron';
import { getStore } from './store.js';
import { getBus } from './events.js';
import { getLogger } from './log.js';
import * as auth from './auth.js';
import * as jsonl from './jsonl.js';
import * as session from './session.js';
import { HookServer } from './hookserver.js';
import { ChannelDispatcher } from './channels/registry.js';
import { SSEChannel } from './channels/sse-channel.js';
import { WeComChannel } from './channels/wecom-channel.js';
import { startProxy, newCallID } from './apiproxy.js';
import { start as startPty, PtyMode, PtySize } from './pty.js';

export class App {
  private window: BrowserWindow | null = null;
  private settingsStore = getStore('settings');
  private instanceStore = getStore('instance');
  private hookServer: HookServer | null = null;
  private dispatcher = new ChannelDispatcher();
  private sseChannel = new SSEChannel();
  private wecomChannel = new WeComChannel({ enabled: false });
  private pendingSession: { resolve: (id: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout } | null = null;

  constructor() {
    this.dispatcher.register(this.sseChannel);
    this.dispatcher.register(this.wecomChannel);
  }

  private registerPending(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.pendingSession) {
        this.pendingSession.reject(new Error('new session creation started'));
        clearTimeout(this.pendingSession.timer);
      }
      const timer = setTimeout(() => {
        this.pendingSession = null;
        reject(new Error('session start timeout (15s)'));
      }, 15000);
      this.pendingSession = { resolve, reject, timer };
    });
  }

  private deliverSessionID(realId: string): void {
    const pending = this.pendingSession;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingSession = null;
    pending.resolve(realId);
  }

  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  async init(): Promise<void> {
    await this.ensureHookServer();
    this.watchJsonl();
    this.registerIpcHandlers();
  }

  private async ensureHookServer(): Promise<void> {
    this.hookServer = new HookServer();
    this.hookServer.onEvent((evt) => {
      const sid = evt.session_id ?? '';
      const name = evt.hook_event_name ?? evt.type ?? '';
      if (name === 'SessionStart' && sid) {
        this.deliverSessionID(sid);
      }
      getBus().emit(`hook:${sid}`, JSON.stringify(evt));
    });
    this.hookServer.onSend(async (sid, prompt) => {
      try {
        session.send(sid, prompt);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    });
    await this.hookServer.start();
  }

  private watchJsonl(): void {
    jsonl.watchProjects(() => {
      getBus().emit('sessions:list:changed');
    });
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('app:isInitialized', () => {
      const hash = this.settingsStore.get('auth.hash', '');
      return auth.isInitialized(hash as string);
    });

    ipcMain.handle('app:verify', (_event, pw: string) => {
      const hash = this.settingsStore.get('auth.hash', '') as string;
      return auth.verifyPassword(hash, pw);
    });

    ipcMain.handle('app:setPassword', (_event, pw: string) => {
      return auth.hashPassword(pw).then((hash) => {
        this.settingsStore.set('auth.hash', hash);
      });
    });

    ipcMain.handle('app:clearPassword', () => {
      this.settingsStore.set('auth.hash', '');
    });

    ipcMain.handle('app:listSessions', () => jsonl.scanAll());

    ipcMain.handle('app:createSession', async (_event, workDir: string, prompt: string) => {
      const token = newCallID();
      const proxy = await startProxy(workDir, token, this.dispatcher);
      const env = { ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}` };
      const proc = startPty(workDir, '', 'claude', PtyMode.Auto, env);
      const tmpId = `tmp-${proc.pid}`;
      const s = session.newSession(tmpId, workDir);
      session.register(s);
      session.setProcess(tmpId, proc);

      const realId = await this.registerPending();
      proxy.setSessionID(realId);
      // migrate tmp session to real id
      session.remove(tmpId);
      const realSession = session.newSession(realId, workDir);
      realSession.process = proc;
      realSession.state = 'running';
      session.register(realSession);
      this.instanceStore.set(`sessions.${realId}.state`, 'running');

      if (prompt) session.send(realId, prompt);
      return realId;
    });

    ipcMain.handle('app:sendMessage', (_event, id: string, prompt: string) => {
      session.send(id, prompt);
    });

    ipcMain.handle('app:closeSession', (_event, id: string) => {
      session.close(id);
    });

    ipcMain.handle('app:getSettings', () => this.settingsStore.store);
    ipcMain.handle('app:updateSettings', (_event, cfg: any) => {
      this.settingsStore.set(cfg);
    });

    ipcMain.handle('app:getSessionStates', async () => {
      const states: Record<string, string> = {};
      const list = await jsonl.scanAll();
      for (const meta of list) {
        const state = this.instanceStore.get(`sessions.${meta.id}.state`, 'idle') as string;
        const hasProcess = !!session.lookup(meta.id)?.process;
        if (state === 'running' && !hasProcess) {
          states[meta.id] = 'idle';
        } else {
          states[meta.id] = state;
        }
      }
      return states;
    });

    ipcMain.handle('app:adoptSession', (_event, id: string, workDir: string) => {
      if (!session.lookup(id)) {
        session.register(session.newSession(id, workDir));
      }
    });

    ipcMain.handle('app:openSessionTerminal', (_event, id: string, workDir: string) => {
      return this.openTerminal(id, workDir);
    });

    ipcMain.handle('app:openSessionTerminalSized', (_event, id: string, workDir: string, cols: number, rows: number) => {
      return this.openTerminal(id, workDir, { cols, rows });
    });

    ipcMain.handle('app:writeTerminalInput', (_event, id: string, data: string) => {
      session.writeInput(id, data);
    });

    ipcMain.handle('app:resizeTerminal', (_event, id: string, cols: number, rows: number) => {
      session.resize(id, cols, rows);
    });

    ipcMain.handle('app:pickDirectory', async () => {
      const result = await dialog.showOpenDialog(this.window!, { properties: ['openDirectory'] });
      return result.filePaths[0] ?? '';
    });

    ipcMain.handle('app:getHookServerPort', () => this.hookServer?.getPort() ?? 0);

    // Window controls
    ipcMain.on('window:minimise', () => this.window?.minimize());
    ipcMain.on('window:maximise', () => this.window?.maximize());
    ipcMain.on('window:unmaximise', () => this.window?.unmaximize());
    ipcMain.on('window:toggleMaximise', () => {
      if (this.window?.isMaximized()) this.window.unmaximize();
      else this.window?.maximize();
    });
    ipcMain.handle('window:isMaximised', () => this.window?.isMaximized() ?? false);
    ipcMain.on('window:show', () => this.window?.show());
    ipcMain.on('window:hide', () => this.window?.hide());
    ipcMain.on('window:setSize', (_event, w: number, h: number) => this.window?.setSize(w, h));
    ipcMain.on('window:setMinSize', (_event, w: number, h: number) => this.window?.setMinimumSize(w, h));
    ipcMain.on('window:setMaxSize', (_event, w: number, h: number) => this.window?.setMaximumSize(w, h));
    ipcMain.on('window:center', () => this.window?.center());
    ipcMain.on('window:quit', () => process.exit(0));
  }

  private openTerminal(id: string, workDir: string, size: PtySize = { cols: 80, rows: 24 }): void {
    if (!session.lookup(id)) session.register(session.newSession(id, workDir));
    const s = session.lookup(id)!;
    if (s.process) return;
    const token = newCallID();
    startProxy(workDir, token, this.dispatcher).then((proxy) => {
      proxy.setSessionID(id);
      const env = { ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}` };
      const proc = startPty(workDir, id, 'claude', PtyMode.Resume, env, size);
      session.setProcess(id, proc);
    });
  }
}
```

- [ ] **Step 2: 修改 electron/main.ts 实例化 App**

在 `createWindow()` 之后调用：

```ts
import { App } from '../src/main/app.js';

const appInstance = new App();
appInstance.setWindow(mainWindow);
await appInstance.init();
```

- [ ] **Step 3: Commit**

```bash
git add src/main/app.ts electron/main.ts
git commit -m "feat: 主 App 与 IPC 路由"
```

---

## Milestone 7: 前端 IPC 替换

**目标:** 删除 `useWails.ts`，新增 `useElectron.ts`，并更新引用。

### Task 7.1: useElectron 组合式函数

**Files:**
- Delete: `frontend/src/composables/useWails.ts`
- Create: `frontend/src/composables/useElectron.ts`

- [ ] **Step 1: 编写 useElectron.ts**

```ts
// frontend/src/composables/useElectron.ts
import type { ElectronAPI } from '../../../electron/preload.js';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

function api(): ElectronAPI {
  if (!window.electronAPI) throw new Error('Electron API not available');
  return window.electronAPI;
}

export const IsInitialized = () => api().isInitialized();
export const Verify = (pw: string) => api().verify(pw);
export const LockoutState = () => api().lockoutState();
export const SetPassword = (pw: string) => api().setPassword(pw);
export const ClearPassword = () => api().clearPassword();
export const ListSessions = () => api().listSessions();
export const CreateSession = (workDir: string, prompt: string) => api().createSession(workDir, prompt);
export const SendMessage = (id: string, prompt: string) => api().sendMessage(id, prompt);
export const CloseSession = (id: string) => api().closeSession(id);
export const GetSettings = () => api().getSettings();
export const UpdateSettings = (cfg: any) => api().updateSettings(cfg);
export const GetHooksConfig = () => api().getHooksConfig();
export const SaveHooksConfig = (cfg: any) => api().saveHooksConfig(cfg);
export const GetSessionMessages = (id: string, workDir: string, offset: number, limit: number) =>
  api().getSessionMessages(id, workDir, offset, limit);
export const GetToolExecutions = (id: string, workDir: string) => api().getToolExecutions(id, workDir);
export const PickDirectory = () => api().pickDirectory();
export const GetHookServerPort = () => api().getHookServerPort();
export const CheckAndFixHooks = () => api().checkAndFixHooks();
export const GetSessionStates = () => api().getSessionStates();
export const AdoptSession = (id: string, workDir: string) => api().adoptSession(id, workDir);
export const OpenSessionTerminal = (id: string, workDir: string) => api().openSessionTerminal(id, workDir);
export const OpenSessionTerminalSized = (id: string, workDir: string, cols: number, rows: number) =>
  api().openSessionTerminalSized(id, workDir, cols, rows);
export const WriteTerminalInput = (id: string, data: string) => api().writeTerminalInput(id, data);
export const ResizeTerminal = (id: string, cols: number, rows: number) => api().resizeTerminal(id, cols, rows);
export const GetProvidersConfig = () => api().getProvidersConfig();
export const SaveProvidersConfig = (cfg: any) => api().saveProvidersConfig(cfg);
export const ApplyActiveProvider = () => api().applyActiveProvider();

export const EventsOn = (channel: string, cb: (...args: any[]) => void) => api().eventsOn(channel, cb);

export const WindowMinimise = () => api().windowMinimise();
export const WindowMaximise = () => api().windowMaximise();
export const WindowUnmaximise = () => api().windowUnmaximise();
export const WindowToggleMaximise = () => api().windowToggleMaximise();
export const WindowIsMaximised = () => api().windowIsMaximised();
export const WindowShow = () => api().windowShow();
export const WindowHide = () => api().windowHide();
export const WindowSetSize = (w: number, h: number) => api().windowSetSize(w, h);
export const WindowSetMinSize = (w: number, h: number) => api().windowSetMinSize(w, h);
export const WindowSetMaxSize = (w: number, h: number) => api().windowSetMaxSize(w, h);
export const WindowCenter = () => api().windowCenter();
export const WindowQuit = () => api().windowQuit();

export const isElectronDev = import.meta.env.DEV;
```

- [ ] **Step 2: 全局替换引用**

Run: `cd G:/work/ease-ui/frontend && grep -rl "useWails" src/`
Expected: 列出所有引用文件。

然后对每个文件：

```ts
// 旧
import { SendMessage, EventsOn } from '../composables/useWails';

// 新
import { SendMessage, EventsOn } from '../composables/useElectron';
```

- [ ] **Step 3: 运行前端类型检查**

Run: `cd G:/work/ease-ui/frontend && npx vue-tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/composables/useElectron.ts
git rm frontend/src/composables/useWails.ts
git add -u frontend/src
git commit -m "refactor: 前端 useWails 替换为 useElectron"
```

---

## Milestone 8: 构建与打包

**目标:** 配置 `electron-builder`，生成三平台可安装包。

### Task 8.1: electron-builder 配置

**Files:**
- Create: `electron-builder.yml`

- [ ] **Step 1: 编写 electron-builder.yml**

```yaml
appId: com.akke.ease-ui
productName: Ease UI
copyright: Copyright © 2026
directories:
  output: dist
  buildResources: build
files:
  - dist-electron/**/*
  - frontend/dist/**/*
  - build/windows/trayicon.ico
extraMetadata:
  main: dist-electron/main.js
win:
  target:
    - target: nsis
      arch: x64
  icon: build/windows/trayicon.ico
mac:
  target:
    - target: dmg
      arch: x64
  category: public.app-category.developer-tools
linux:
  target:
    - target: AppImage
      arch: x64
  category: Development
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 2: Commit**

```bash
git add electron-builder.yml
git commit -m "chore: electron-builder 打包配置"
```

### Task 8.2: 构建脚本验证

**Files:**
- Modify: `package.json`（如需要）

- [ ] **Step 1: 运行生产构建**

Run: `cd G:/work/ease-ui && npm run build`
Expected: `frontend/dist` 和 `dist-electron` 都生成。

- [ ] **Step 2: 运行打包**

Run: `cd G:/work/ease-ui && npm run dist:win`
Expected: `dist/ease-ui Setup.exe` 生成。

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "chore: 验证 Electron 构建与打包"
```

---

## 人天分配

| Milestone | 人天 |
|---|---|
| M0: 项目初始化 | 1 |
| M1: 基础后端模块 | 3 |
| M2: 会话与 PTY | 3 |
| M3: HookServer | 2 |
| M4: API Proxy + Channel Dispatcher + SSE | 4 |
| M5: WeCom Channel | 2 |
| M6: 主 App 与 IPC 路由 | 4 |
| M7: 前端 IPC 替换 | 2 |
| M8: 构建与打包 | 3 |
| 测试/联调/bugfix | 6 |
| **总计** | **30 人天** |

---

## 自检

### Spec 覆盖检查

- [x] Electron 主进程搭建 → Task 0.3, 6.1
- [x] Vue 前端复用 → Task 7.1
- [x] Go 后端迁移 → Task 1.x, 2.x, 3.1, 4.3, 4.4, 6.1
- [x] Channel Dispatcher → Task 4.1
- [x] SSE channel → Task 4.2
- [x] API Proxy 解析 → Task 4.4
- [x] WeCom channel → Task 5.2, 5.3
- [x] 构建打包 → Task 8.1, 8.2

### Placeholder 扫描

- 无 TBD/TODO/FIXME。
- `Task 5.3` 提供插件导出的兜底 require 路径。
- `Task 6.1` 已实现 SessionStart hook 等待真实 UUID 的逻辑。

### 类型一致性

- `ProxyStageEvent` 在 `channel.ts` 定义，被 `registry.ts`、`sse-channel.ts`、`wecom-channel.ts` 共用。
- `PtySize` 在 `pty.ts` 定义，被 `session.ts`、`app.ts` 共用。
