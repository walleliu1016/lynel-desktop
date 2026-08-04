# VS Code 扩展 — Lynel Claude 终端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 VS Code 扩展，将 Claude AI 交互终端嵌入 VS Code 内置终端面板，支持多终端标签（+），与现有 Electron 应用零耦合。

**Architecture:** 在仓库根目录新增 `vscode-extension/` 独立目录。扩展通过 VS Code `Pseudoterminal` 接口对接 `node-pty`，在扩展主机（Node.js 进程）中运行 session/hook/proxy/permission 核心逻辑。不修改现有 `src/main/`、`src/renderer/` 任何文件。

**Tech Stack:** TypeScript, VS Code Extension API, node-pty, @xterm/headless (截图), Express (hook server), undici (HTTP)

## Global Constraints

- 不修改现有 `src/main/`、`src/renderer/`、根 `package.json` 任何文件
- `vscode-extension/` 目录完全独立，有自己的 `package.json`、`tsconfig.json`
- 核心逻辑从现有代码**复制**后裁剪（去掉 Electron 特定部分），不抽取共享模块
- 复用 `~/.lynel-desktop/` 数据目录结构（settings.json、projects/、hooks 等）
- 支持 Windows / macOS / Linux 三平台

---

## 文件结构总览

```
vscode-extension/                        （新增，完全独立）
├── package.json                         （扩展清单 + 依赖 + contributes）
├── tsconfig.json                        （TypeScript 编译配置）
├── .vscodeignore                        （打包忽略文件）
├── src/
│   ├── extension.ts                     （入口：activate/deactivate）
│   ├── terminal-manager.ts              （终端实例管理器，Pseudoterminal 工厂）
│   ├── pty-bridge.ts                    （node-pty 封装，裁剪自 src/main/pty.ts）
│   ├── session.ts                       （Session 管理，复制自 src/main/session.ts）
│   ├── output-batcher.ts                （输出合帧，复制自 src/main/output-batcher.ts）
│   ├── hookserver.ts                    （Hook HTTP 服务，裁剪自 src/main/hookserver.ts）
│   ├── apiproxy.ts                      （API 代理，裁剪自 src/main/apiproxy.ts）
│   ├── permission-broker.ts             （权限仲裁，复制自 src/main/permission-broker.ts）
│   ├── config.ts                        （读取 ~/.lynel-desktop/settings.json 配置）
│   ├── status-bar.ts                    （VS Code 状态栏项：会话数、快捷命令）
│   └── commands.ts                      （VS Code 命令注册）
└── test/
    └── extension.test.ts                （激活/终端创建 基本测试）
```

---

### Task 1: 项目脚手架与编译配置

**Files:**
- Create: `vscode-extension/package.json`
- Create: `vscode-extension/tsconfig.json`
- Create: `vscode-extension/.vscodeignore`
- Create: `vscode-extension/.gitignore`

**Interfaces:**
- Produces: `package.json` activates on `"*"` event, contributes commands & terminal profiles

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "lynel-vscode",
  "displayName": "Lynel - Claude AI Terminal",
  "description": "Embed Claude AI interactive terminal in VS Code",
  "version": "0.0.14",
  "publisher": "lynel",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "lynel.newTerminal", "title": "Lynel: New Claude Terminal" },
      { "command": "lynel.newTerminalWithWorkDir", "title": "Lynel: New Claude Terminal in Workspace" },
      { "command": "lynel.closeAllTerminals", "title": "Lynel: Close All Terminals" },
      { "command": "lynel.showSettings", "title": "Lynel: Open Settings" }
    ],
    "configuration": {
      "title": "Lynel",
      "properties": {
        "lynel.claudeBin": {
          "type": "string",
          "default": "claude",
          "description": "Path to the Claude CLI binary"
        },
        "lynel.dataDir": {
          "type": "string",
          "default": "",
          "description": "Lynel data directory (default: ~/.lynel-desktop)"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./tsconfig.json",
    "watch": "tsc -watch -p ./tsconfig.json",
    "pretest": "npm run compile",
    "test": "node ./dist/test/runTest.js"
  },
  "dependencies": {
    "node-pty": "^1.0.0",
    "express": "^4.21.0",
    "undici": "^7.24.6"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^22.10.0",
    "@types/express": "^5.0.6",
    "@vscode/test-electron": "^2.4.0",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: 创建 .vscodeignore**

```
.vscode/**
.gitignore
node_modules/**
src/**
test/**
tsconfig.json
**/*.ts
**/*.map
```

- [ ] **Step 4: 创建 .gitignore**

```
dist/
node_modules/
```

- [ ] **Step 5: 安装依赖并验证编译**

```bash
cd vscode-extension && npm install && npm run compile
```

Expected: `dist/extension.js` 生成（空骨架即可，Task 2 填充）。验证编译无报错。

- [ ] **Step 6: Commit**

```bash
git add vscode-extension/package.json vscode-extension/tsconfig.json vscode-extension/.vscodeignore vscode-extension/.gitignore
git commit -m "feat(vscode): 初始化 VS Code 扩展项目脚手架"
```

---

### Task 2: extension.ts 入口 — 激活/停用生命周期

**Files:**
- Create: `vscode-extension/src/extension.ts`

**Interfaces:**
- Produces: `activate(context)` — 注册命令、初始化状态栏、预加载 shell 环境
- Produces: `deactivate()` — 关闭所有终端、清理资源

- [ ] **Step 1: 编写 extension.ts**

```typescript
import * as vscode from 'vscode';
import { TerminalManager } from './terminal-manager.js';
import { StatusBarManager } from './status-bar.js';
import { registerCommands } from './commands.js';
import { preloadEnv } from './pty-bridge.js';

let terminalManager: TerminalManager;
let statusBar: StatusBarManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 预加载 shell 环境（macOS PATH 修复）
  await preloadEnv();

  terminalManager = new TerminalManager();
  statusBar = new StatusBarManager(terminalManager);

  registerCommands(context, terminalManager);

  // 扩展激活时自动创建一个 Claude 终端
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    await terminalManager.createTerminal(wsFolder.uri.fsPath);
  }

  context.subscriptions.push(terminalManager, statusBar);
}

export function deactivate(): void {
  terminalManager?.dispose();
}
```

- [ ] **Step 2: 验证 compile**

```bash
cd vscode-extension && npx tsc --noEmit
```

Expected: 类型错误（因引用的模块尚未创建），但 extension.ts 自身语法正确。这些错误将在后续 Task 逐步消除。

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/src/extension.ts
git commit -m "feat(vscode): 扩展入口 — activate/deactivate 生命周期"
```

---

### Task 3: pty-bridge.ts — node-pty 封装（裁剪自 src/main/pty.ts）

**Files:**
- Create: `vscode-extension/src/pty-bridge.ts`

**Interfaces:**
- Consumes: `node-pty`, shell env
- Produces: `PtyProcess` interface, `PtyMode` enum, `PtySize` interface, `start(opts)`, `preloadEnv()`, `resolveBin()`

这个文件从 `src/main/pty.ts` 裁剪，**只保留 PTY spawn/resize/kill 通用逻辑**，移除 Electron-specific 的 `getLogger`、`OutputRing` 等。

- [ ] **Step 1: 编写 pty-bridge.ts**

```typescript
import * as pty from 'node-pty';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';

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
  onExit: (cb: (info: PtyExitInfo) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
}

export interface PtyExitInfo {
  code: number;
  durationMs: number;
  outputTail: string;
  resolvedBin: string;
  binExists: boolean | 'unknown';
  spawnArgs: string[];
  cwd: string;
}

// macOS env 缓存（与现有逻辑一致）
let cachedDarwinEnv: Record<string, string> | null = null;

export async function preloadEnv(): Promise<void> {
  if (os.platform() !== 'darwin') return;
  const userShell = process.env.SHELL || '/bin/zsh';
  return new Promise<void>((resolve) => {
    const child = require('node:child_process').execFile(
      userShell, ['-ilc', 'env'],
      { maxBuffer: 1024 * 1024 },
      (err: Error | null, stdout: string) => {
        if (!err && stdout) {
          cachedDarwinEnv = {};
          for (const line of stdout.split('\n')) {
            const idx = line.indexOf('=');
            if (idx > 0) {
              cachedDarwinEnv[line.slice(0, idx)] = line.slice(idx + 1);
            }
          }
        }
        resolve();
      },
    );
  });
}

function resolveBin(bin: string, env: Record<string, string>): string {
  if (os.platform() === 'win32' && !bin.endsWith('.exe') && !bin.endsWith('.cmd')) {
    return bin + '.cmd';
  }
  const envPath = env.PATH || process.env.PATH || '';
  const dirs = envPath.split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, bin);
    if (fs.existsSync(candidate)) return candidate;
  }
  return bin; // fallback
}

function buildCommand(
  bin: string, args: string[], mode: PtyMode, sid: string,
): { shell: string; shellArgs: string[] } {
  if (os.platform() === 'win32') {
    const allArgs = [bin, ...args];
    if (mode === PtyMode.New) allArgs.push('--session-id', sid);
    else if (mode === PtyMode.Resume) allArgs.push('--resume', sid);
    return {
      shell: 'cmd.exe',
      shellArgs: ['/c', allArgs.join(' ')],
    };
  }
  const finalArgs = [...args];
  if (mode === PtyMode.New) finalArgs.push('--session-id', sid);
  else if (mode === PtyMode.Resume) finalArgs.push('--resume', sid);
  return { shell: bin, shellArgs: finalArgs };
}

export interface StartPtyOptions {
  bin: string;
  args?: string[];
  mode: PtyMode;
  sessionId: string;
  workDir: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export function startPty(opts: StartPtyOptions): PtyProcess {
  const { bin, args = [], mode, sessionId, workDir, cols = 80, rows = 24 } = opts;
  const mergedEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...(os.platform() === 'darwin' ? cachedDarwinEnv : {}),
    ...opts.env,
  };
  const resolvedBin = resolveBin(bin, mergedEnv);
  const { shell, shellArgs } = buildCommand(resolvedBin, args, mode, sessionId);

  const startTime = Date.now();
  const outputChunks: string[] = [];

  const proc = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: workDir,
    env: mergedEnv,
  });

  const adapt: PtyProcess = {
    pid: proc.pid,
    onData(cb) {
      (proc as any).onData((d: string) => {
        outputChunks.push(d);
        if (outputChunks.length > 200) outputChunks.shift();
        cb(d);
      });
    },
    onExit(cb) {
      proc.onExit(({ exitCode }) => {
        cb({
          code: exitCode,
          durationMs: Date.now() - startTime,
          outputTail: outputChunks.join('').slice(-4096),
          resolvedBin,
          binExists: fs.existsSync(resolvedBin),
          spawnArgs: shellArgs,
          cwd: workDir,
        });
      });
    },
    write(data) { proc.write(data); },
    resize(cols, rows) { proc.resize(cols, rows); },
    kill(signal) {
      if (os.platform() === 'win32') {
        try { execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)]); } catch {}
      } else {
        proc.kill(signal || 'SIGTERM');
      }
    },
  };

  return adapt;
}
```

- [ ] **Step 2: 验证编译**

```bash
cd vscode-extension && npx tsc --noEmit
```

Expected: pty-bridge.ts 编译通过。extension.ts 仍有未解析依赖（terminal-manager, status-bar 等），正常。

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/src/pty-bridge.ts
git commit -m "feat(vscode): node-pty 封装 — 裁剪自 src/main/pty.ts"
```

---

### Task 4: session.ts + output-batcher.ts — session 管理（直接复制）

**Files:**
- Create: `vscode-extension/src/session.ts`
- Create: `vscode-extension/src/output-batcher.ts`

**Interfaces:**
- Consumes: `PtyProcess` from pty-bridge.ts
- Produces: `Session`, `SessionState`, `newSession()`, `register()`, `lookup()`, `setProcess()`, `send()`, `writeInput()`, `resize()`, `close()`, `remove()`, `list()`, `appendBuffer()`

Session 模块是纯逻辑，与原版几乎一致。唯一差异：移除 `settingsFile` 字段。

- [ ] **Step 1: 编写 output-batcher.ts**

直接复制自 `src/main/output-batcher.ts`，无需改动。

- [ ] **Step 2: 编写 session.ts**

```typescript
import { PtyProcess, PtySize } from './pty-bridge.js';

export type SessionState = 'idle' | 'running' | 'awaiting_permission' | 'done';

export interface Session {
  id: string;
  workDir: string;
  state: SessionState;
  process: PtyProcess | null;
  lastHookAt: number;
  buffer: string;
  cols: number;
  rows: number;
}

const MAX_BUFFER = 65536;

const sessions = new Map<string, Session>();

export function appendBuffer(id: string, data: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.buffer += data;
  if (s.buffer.length > MAX_BUFFER) {
    s.buffer = s.buffer.slice(s.buffer.length - MAX_BUFFER);
  }
}

export function getBuffer(id: string): string {
  return sessions.get(id)?.buffer ?? '';
}

export function newSession(id: string, workDir: string): Session {
  return {
    id, workDir, state: 'idle', process: null,
    lastHookAt: 0, buffer: '', cols: 80, rows: 24,
  };
}

export function register(session: Session): void { sessions.set(session.id, session); }
export function lookup(id: string): Session | undefined { return sessions.get(id); }

export function remove(id: string): void {
  close(id);
  sessions.delete(id);
}

export function list(): Session[] { return Array.from(sessions.values()); }

export function setProcess(id: string, proc: PtyProcess, size?: PtySize): void {
  const s = sessions.get(id);
  if (s) { s.process = proc; s.state = 'running'; if (size) { s.cols = size.cols; s.rows = size.rows; } }
}

export function touch(id: string): void {
  const s = sessions.get(id);
  if (s) s.lastHookAt = Date.now();
}

export function setState(id: string, state: SessionState): void {
  const s = sessions.get(id);
  if (s) s.state = state;
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
  if (!s) return;
  s.cols = cols; s.rows = rows;
  if (s.process) s.process.resize(cols, rows);
}

export function close(id: string, signal?: string): void {
  const s = sessions.get(id);
  if (s?.process) { s.process.kill(signal); s.process = null; s.state = 'done'; }
}

export function getSize(id: string): { cols: number; rows: number } | undefined {
  const s = sessions.get(id);
  return s ? { cols: s.cols, rows: s.rows } : undefined;
}
```

- [ ] **Step 3: 验证编译**

```bash
cd vscode-extension && npx tsc --noEmit
```

Expected: session.ts, output-batcher.ts 编译通过。

- [ ] **Step 4: Commit**

```bash
git add vscode-extension/src/session.ts vscode-extension/src/output-batcher.ts
git commit -m "feat(vscode): session 管理 + output-batcher — 复制自主进程"
```

---

### Task 5: terminal-manager.ts — VS Code Pseudoterminal 终端管理器

**Files:**
- Create: `vscode-extension/src/terminal-manager.ts`

**Interfaces:**
- Consumes: `vscode.Pseudoterminal`, `PtyProcess` from pty-bridge, Session from session
- Produces: `TerminalManager.createTerminal(workDir)` — 创建 VS Code 终端实例

这是核心模块。每个终端实例 = 1 个 `vscode.Pseudoterminal` + 1 个 `PtyProcess` + 1 个 Session。

- [ ] **Step 1: 编写 terminal-manager.ts**

```typescript
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import {
  PtyMode, startPty, type PtyProcess, type PtyExitInfo,
} from './pty-bridge.js';
import {
  newSession, register, lookup, remove, setProcess, writeInput,
  resize as sessionResize, appendBuffer,
} from './session.js';
import { OutputBatcher } from './output-batcher.js';
import { getConfig } from './config.js';

class LynelPseudoterminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<number>();
  private proc: PtyProcess | null = null;
  private batcher: OutputBatcher;
  private sessionId: string;
  private workDir: string;
  private onDispose: (id: string) => void;

  onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  onDidClose: vscode.Event<number> = this.closeEmitter.event;

  constructor(sessionId: string, workDir: string, onDispose: (id: string) => void) {
    this.sessionId = sessionId;
    this.workDir = workDir;
    this.onDispose = onDispose;
    this.batcher = new OutputBatcher((_, data) => {
      // PTY ANSI 输出直接写入 VS Code 终端
      this.writeEmitter.fire(data);
    });
  }

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    const cols = initialDimensions?.columns ?? 80;
    const rows = initialDimensions?.rows ?? 24;

    const session = newSession(this.sessionId, this.workDir);
    register(session);

    const config = getConfig();
    const proc = startPty({
      bin: config.claudeBin,
      mode: PtyMode.New,
      sessionId: this.sessionId,
      workDir: this.workDir,
      cols,
      rows,
    });

    this.proc = proc;
    setProcess(this.sessionId, proc, { cols, rows });

    proc.onData((data: string) => {
      appendBuffer(this.sessionId, data);
      this.batcher.push(this.sessionId, data);
    });

    proc.onExit((info: PtyExitInfo) => {
      this.batcher.flush(this.sessionId);
      if (info.code !== 0 || info.durationMs < 5000) {
        this.writeEmitter.fire(`\r\n\x1b[31m[Claude exited with code ${info.code} after ${info.durationMs}ms]\x1b[0m\r\n`);
      }
      this.closeEmitter.fire(info.code);
    });
  }

  close(): void {
    this.batcher.clear(this.sessionId);
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    remove(this.sessionId);
    this.onDispose(this.sessionId);
  }

  handleInput(data: string): void {
    if (this.proc) {
      writeInput(this.sessionId, data);
    }
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    sessionResize(this.sessionId, dimensions.columns, dimensions.rows);
  }
}

export class TerminalManager implements vscode.Disposable {
  private terminals = new Map<string, { terminal: vscode.Terminal; pty: LynelPseudoterminal }>();

  async createTerminal(workDir?: string): Promise<vscode.Terminal> {
    const sessionId = randomUUID();
    const cwd = workDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const name = `Claude ${sessionId.slice(0, 8)}`;

    const pty = new LynelPseudoterminal(sessionId, cwd, (id) => {
      this.terminals.delete(id);
    });

    const terminal = vscode.window.createTerminal({
      name,
      pty,
      iconPath: new vscode.ThemeIcon('comment-discussion'),
    });

    this.terminals.set(sessionId, { terminal, pty });
    terminal.show();
    return terminal;
  }

  getTerminalCount(): number {
    return this.terminals.size;
  }

  closeAll(): void {
    for (const [, entry] of this.terminals) {
      entry.terminal.dispose();
    }
  }

  dispose(): void {
    this.closeAll();
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
cd vscode-extension && npx tsc --noEmit
```

Expected: terminal-manager.ts 编译通过。config.ts 未创建则报错 — 接下来创建。

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/src/terminal-manager.ts
git commit -m "feat(vscode): Pseudoterminal 终端管理器 — 多终端创建/销毁"
```

---

### Task 6: config.ts + status-bar.ts + commands.ts — VS Code 集成

**Files:**
- Create: `vscode-extension/src/config.ts`
- Create: `vscode-extension/src/status-bar.ts`
- Create: `vscode-extension/src/commands.ts`

**Interfaces:**
- Consumes: `vscode.workspace.getConfiguration`, `TerminalManager`
- Produces: `LynelConfig`, `StatusBarManager`, `registerCommands()`

- [ ] **Step 1: 编写 config.ts**

```typescript
import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface LynelConfig {
  claudeBin: string;
  dataDir: string;
}

export function getConfig(): LynelConfig {
  const cfg = vscode.workspace.getConfiguration('lynel');
  const dataDir = cfg.get<string>('dataDir', '') ||
    path.join(os.homedir(), '.lynel-desktop');
  return {
    claudeBin: cfg.get<string>('claudeBin', 'claude'),
    dataDir,
  };
}

// 读取 Lynel Desktop settings.json（复用现有配置）
export function getLynelSettings(): Record<string, unknown> {
  const config = getConfig();
  const settingsPath = path.join(config.dataDir, 'settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch {}
  return {};
}
```

- [ ] **Step 2: 编写 status-bar.ts**

```typescript
import * as vscode from 'vscode';
import type { TerminalManager } from './terminal-manager.js';

export class StatusBarManager implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor(private terminalManager: TerminalManager) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 50,
    );
    this.item.command = 'lynel.newTerminal';
    this.item.tooltip = 'Lynel: New Claude Terminal';
    this.update();
    this.item.show();
  }

  update(): void {
    const count = this.terminalManager.getTerminalCount();
    this.item.text = `$(comment-discussion) Claude${count > 1 ? ` (${count})` : ''}`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
```

- [ ] **Step 3: 编写 commands.ts**

```typescript
import * as vscode from 'vscode';
import type { TerminalManager } from './terminal-manager.js';

export function registerCommands(
  context: vscode.ExtensionContext,
  terminalManager: TerminalManager,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.newTerminal', async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      await terminalManager.createTerminal(
        wsFolder?.uri.fsPath ?? process.cwd(),
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.newTerminalWithWorkDir', async () => {
      const folders = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Start Claude Session',
      });
      if (folders?.[0]) {
        await terminalManager.createTerminal(folders[0].fsPath);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.closeAllTerminals', () => {
      terminalManager.closeAll();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.showSettings', () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'lynel',
      );
    }),
  );
}
```

- [ ] **Step 4: 验证全量编译**

```bash
cd vscode-extension && npx tsc --noEmit && npm run compile
```

Expected: 全部编译通过，`dist/` 目录生成。

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/src/config.ts vscode-extension/src/status-bar.ts vscode-extension/src/commands.ts vscode-extension/dist/
git commit -m "feat(vscode): 配置读取 + 状态栏 + 命令注册"
```

---

### Task 7: hookserver.ts + permission-broker.ts — Hook 与权限支持

**Files:**
- Create: `vscode-extension/src/hookserver.ts`
- Create: `vscode-extension/src/permission-broker.ts`

**Interfaces:**
- Consumes: `Session` from session, `getConfig` from config
- Produces: `HookServer` class, `PermissionBroker` class

- [ ] **Step 1: 编写 permission-broker.ts**

从 `src/main/permission-broker.ts` 直接复制，类接口完全一致。权限请求通过 `vscode.window.showQuickPick` 在终端内交互式处理。

- [ ] **Step 2: 编写 hookserver.ts（裁剪版）**

从 `src/main/hookserver.ts` 裁剪，**移除 SSE/WeCom/LocalFile channel 依赖**，保留核心 `/hook` 端点和 permission 处理。Hook 事件通过 `vscode.window` API 通知用户。

```typescript
import express, { Request, Response } from 'express';
import http from 'node:http';
import type { PermissionBroker } from './permission-broker.js';

export class HookServer {
  private app = express();
  private server: http.Server | null = null;
  private port: number = 0;
  private permissionBroker: PermissionBroker;

  constructor(permissionBroker: PermissionBroker) {
    this.permissionBroker = permissionBroker;
    this.app.use(express.json());
    this.app.post('/hook', (req, res) => this.handleHook(req, res));
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = this.app.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as { port: number };
        this.port = addr.port;
        resolve(this.port);
      });
    });
  }

  getPort(): number { return this.port; }

  private async handleHook(req: Request, res: Response): Promise<void> {
    const body = req.body;
    // Permission hook: 委托给 PermissionBroker
    if (body.type === 'permission' || body.hook_event_name === 'PermissionRequest') {
      const result = await this.permissionBroker.wait({
        id: body.session_id + '::' + (body.tool_name || 'unknown'),
        sessionId: body.session_id,
        workDir: body.work_dir || process.cwd(),
        toolName: body.tool_name || 'unknown',
        toolInput: body.tool_input || body.request || {},
      });
      res.json({
        decision: result.decision,
        answers: result.answers,
      });
      return;
    }
    // 其他 hook: 直接允许
    res.json({ allowed: true });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server?.close(() => resolve());
    });
  }
}
```

- [ ] **Step 3: 集成到 terminal-manager**

修改 `LynelPseudoterminal.open()` 启动 HookServer 并在 env 注入 `ANTHROPIC_BASE_URL`，使 Claude CLI 通过代理通信。

- [ ] **Step 4: 验证编译**

```bash
cd vscode-extension && npx tsc --noEmit
```

Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/src/hookserver.ts vscode-extension/src/permission-broker.ts
git commit -m "feat(vscode): hook 服务器 + 权限仲裁"
```

---

### Task 8: apiproxy.ts — API 代理（裁剪版）

**Files:**
- Create: `vscode-extension/src/apiproxy.ts`

**Interfaces:**
- Consumes: `SessionAdapter` 逻辑, HookServer
- Produces: `APIProxy` class — 拦截 Claude API 流量写 JSONL archive

裁剪原则：移除 WeCom channel 分发、简化 archive 写入（只保留 JSONL，不带 SSE 流式推送到 UI）。

- [ ] **Step 1: 编写 apiproxy.ts**

提取 `src/main/apiproxy.ts` 中 HTTP→HTTPS 代理核心逻辑，去掉 channel dispatcher。代理端口自动分配，env 注入 `ANTHROPIC_BASE_URL=http://127.0.0.1:<proxyPort>`。

- [ ] **Step 2: 集成到 terminal-manager**

在 `open()` 中先启动 APIProxy 获取端口 → 注入 env → 再启动 PTY。

- [ ] **Step 3: 验证编译**

```bash
cd vscode-extension && npx tsc --noEmit
```

Expected: 全部通过。

- [ ] **Step 4: Commit**

```bash
git add vscode-extension/src/apiproxy.ts
git commit -m "feat(vscode): API 代理 — HTTP→HTTPS Claude 流量拦截"
```

---

### Task 9: 端到端调试验证

**Files:**
- Create: `vscode-extension/.vscode/launch.json` (调试配置)

**验证项:**

- [ ] **Step 1: 创建 .vscode/launch.json**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}/vscode-extension"],
      "outFiles": ["${workspaceFolder}/vscode-extension/dist/**/*.js"]
    }
  ]
}
```

- [ ] **Step 2: F5 启动调试**

在 VS Code 中按 F5，验证：
- 状态栏显示 "Claude" 图标
- 自动创建一个 Claude 终端标签
- 终端内可看到 Claude CLI 启动输出
- 能正常与 Claude 交互
- Ctrl+C 中断正常
- 关闭终端标签后进程清理正常

- [ ] **Step 3: 验证多终端**

按 `Ctrl+Shift+P` → `Lynel: New Claude Terminal`：
- 创建第二个终端标签
- 两个终端独立运行，互不影响
- VS Code 终端面板 "+" 下拉可选 Claude 终端

- [ ] **Step 4: 修复验证中发现的问题**

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/.vscode/launch.json
git commit -m "chore(vscode): 调试配置 + 端到端验证修复"
```

---

### Task 10: CI 构建 + 打包 vsix

**Files:**
- Create: `.github/workflows/vscode-extension.yml`
- Modify: `vscode-extension/package.json` (scripts)

- [ ] **Step 1: 添加打包脚本到 package.json**

```bash
cd vscode-extension && npm install -D @vscode/vsce
```

在 `vscode-extension/package.json` 的 scripts 中添加：
```json
"package": "vsce package"
```

- [ ] **Step 2: 创建 GitHub Actions workflow**

```yaml
name: Build VS Code Extension
on:
  push:
    paths:
      - 'vscode-extension/**'
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: cd vscode-extension && npm ci && npm run compile
      - run: cd vscode-extension && npm test
```

- [ ] **Step 3: Commit**

```bash
git add vscode-extension/package.json .github/workflows/vscode-extension.yml
git commit -m "ci(vscode): 扩展打包脚本 + GitHub Actions"
```

---

## 后续迭代（不在本计划范围）
- Task 11: `--resume` 支持（恢复已有 session）
- Task 12: 权限 UI（webview panel 或 quick pick 交互）
- Task 13: Trace 查看器（webview panel，复用现有 trace store 逻辑）
- Task 14: 企业微信 channel 集成
- Task 15: 扩展市场发布（publish to VS Code Marketplace）
