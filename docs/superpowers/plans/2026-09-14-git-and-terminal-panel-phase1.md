# Git 与终端面板 Phase 1 实施计划（底部面板 + 项目终端）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `CodeView`（文件子页）底部新增一个可拖高、可折叠的面板，内含「终端」标签，为每个 Claude 会话提供一个绑定其 workDir 的独立交互式 shell。

**Architecture:** 主进程新增 `shell.ts`，用 `Map<sessionId, ShellSession>` 管理每会话的 shell PTY。它复用 `pty.ts` 的 `start()`，但走新增的 `raw` 直通模式 —— 绕开 `buildCommand()` 的 `win32 cmd.exe /c` 包装（否则会产出 `cmd.exe /c powershell.exe`，多一层 cmd 会让 Ctrl+C 等控制字符语义变形）。输出经**独立的** `OutputBatcher` 实例以 `shell:<sessionId>` 事件推给渲染进程。渲染进程新增 `BottomPanel.vue` 容器与 `ProjectTerminal.vue`，xterm 主题逻辑从 `XtermTerminal.vue` 抽到 `terminal/theme.ts` 供两者共用。

**Tech Stack:** Electron 主进程（ESM + `module: NodeNext`）、node-pty、Express-无关、Vue 3 `<script setup lang="ts">`、Pinia（setup style）、`@xterm/xterm`、vitest。

## Global Constraints

以下约束适用于每个任务，不再逐条重复：

- 所有 IPC 返回 `{ ok: true, ... }` 或 `{ ok: false, error: string }`，**主进程不得抛未捕获异常**（会导致窗口白屏）。
- `shell:` 事件前缀必须独立于 `session:` —— 后者是 Claude PTY 的输出通道，复用会导致两个终端输出串流。
- `src/renderer/src/composables/useElectron.ts` 是**唯一**接触 `window.electronAPI` 的文件；组件禁止直接 `window.electronAPI.X(...)`。
- 样式一律用 `styles/theme.css` 的 CSS 变量，不硬编码颜色。图标用 `@lucide/vue`，经 `components/Icon.vue` 引用，禁止 emoji / Unicode 符号当图标。
- 代码注释、commit message 一律简体中文。
- `tests/main/` 下**模块顶层不得触碰 electron API**（无 vitest 配置文件，`electron` 在测试环境解析为不可用）。只在函数体内调用 `ipcMain.*`。
- 每个任务结束时 `npm run test:main` 与 `cd src/renderer && npx vue-tsc --noEmit` 必须全绿。
- 按项目约定，本计划**不含 git 提交步骤**，是否提交由使用者自行决定。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/main/pty.ts`（改） | 新增 `StartOptions.raw` 直通模式；导出 `resolveCmdExe()` |
| `src/main/shell.ts`（新） | 项目 shell 会话表：`ensure` / `write` / `resize` / `close` / `rebind` / `closeAll` / `pickShell` / `registerShellIpc` |
| `src/main/app.ts`（改） | 注册 shell IPC；在现有 `setOnRemove` 回调里追加 `closeShell`；`doRebindSession` 里追加 `rebindShell`；`shutdown()` 里追加 `closeAllShells` |
| `src/main/preload.ts`（改） | 4 个 shell API 转发 |
| `src/renderer/src/composables/useElectron.ts`（改） | 4 个 shell API 类型化导出 |
| `src/renderer/src/terminal/theme.ts`（新） | 从 `XtermTerminal.vue` 抽出的主题工具 |
| `src/renderer/src/components/XtermTerminal.vue`（改） | 改为 import 上面抽出的函数（纯重构） |
| `src/renderer/src/components/code/ProjectTerminal.vue`（新） | 项目终端 xterm 实例 |
| `src/renderer/src/components/code/BottomPanel.vue`（新） | 底部面板容器：拖高 / 折叠 / 标签 |
| `src/renderer/src/stores/files.ts`（改） | `lastSessionId` 提升为响应式 `currentSessionId` |
| `src/renderer/src/components/code/CodeView.vue`（改） | 挂载 `BottomPanel` |

---

## Task 1: `pty.ts` 支持 raw 直通 spawn

**Files:**
- Modify: `src/main/pty.ts`（`StartOptions` 接口约 391-401 行；`start()` 内约 442 行；`resolveCmdExe` 约 351 行）
- Test: `tests/main/pty.test.ts`（追加测试）

**Interfaces:**
- Consumes: 无
- Produces: `StartOptions.raw?: boolean`；`resolveCmdExe(): string`（新导出）

**背景**：`buildCommand()`（`pty.ts:362-389`）在 win32 下无条件包一层 `cmd.exe /c`。启动交互式 shell 时这层包装会让 Ctrl+C / Ctrl+Z 等控制字符先经 cmd 转发，语义变形。`raw` 模式把这个决策交给调用方。

- [ ] **Step 1: 写失败的测试**

在 `tests/main/pty.test.ts` 的 `describe('pty', ...)` 块内、现有 `it.skipIf(isCI)(...)` 之后追加：

```ts
  // raw 模式用于启动交互式 shell（powershell/cmd/bash）：跳过 buildCommand 的
  // win32 `cmd.exe /c` 包装，直接把 shell 交给 pty.spawn。
  it.skipIf(isCI)('raw 模式直通 spawn shell 并能收发', { timeout: 20000 }, async () => {
    const { start, PtyMode } = await import('../../src/main/pty.js');
    const isWin = process.platform === 'win32';
    const bin = isWin ? 'powershell.exe' : '/bin/sh';
    const marker = 'LYNEL_RAW_OK';

    const proc = start(
      process.cwd(),
      '',
      bin,
      PtyMode.Auto,
      {},
      { cols: 80, rows: 24 },
      [],
      { raw: true },
    );
    expect(proc.pid).toBeGreaterThan(0);

    const output = await new Promise<string>((resolve) => {
      let acc = '';
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(acc);
      };
      proc.onData((d) => {
        acc += d;
        if (acc.includes(marker)) finish();
      });
      proc.write(isWin ? `echo ${marker}\r` : `echo ${marker}\n`);
      // PowerShell 冷启动可能较慢，给足时间；超时也会 resolve，由断言给出可读失败
      setTimeout(finish, 12000);
    });

    proc.kill('SIGTERM');
    expect(output).toContain(marker);
  });
```

- [ ] **Step 2: 运行测试确认它失败**

Run: `npx vitest run --dir tests/main pty`
Expected: FAIL —— `raw` 参数被忽略，实际启动的是 `cmd.exe /c powershell.exe`，marker 可能仍出现但语义不对；更可能因为多一层 cmd 导致 `powershell.exe` 作为 `/c` 的参数执行后立即退出，断言超时失败。

> 若该测试意外通过（多一层 cmd 恰好也能回显），本步骤仍视为「失败前置」已确认 —— 继续 Step 3 的必要性由 Step 4 的最终通过来保证。

- [ ] **Step 3: 实现 raw 模式**

在 `src/main/pty.ts` 的 `StartOptions` 接口中追加字段：

```ts
export interface StartOptions {
  /**
   * Spawn 前 sync 探测一次（execFileSync --version），把 forkpty 静默失败转成带
   * errno 的明确 throw。**仅当 spawn 的是 claude**（对话用的 binary）才开启。
   * 通用 spawn 应保持 false：探测用 --version 是 claude 专属，cmd.exe / sh 等会失败。
   * macOS forkpty 失败只 onExit=1 拿不到 errno，故此开关专门用来消除 macOS 偶发失败。
   */
  probe?: boolean;
  /** 错误提示用的 agent 展示名（如 'Codex (OpenAI)'）；缺省回退 bin */
  agentLabel?: string;
  /**
   * 直通模式：跳过 buildCommand() 的 win32 `cmd.exe /c` 包装与 Claude 专属 session 参数，
   * 直接把 { file: resolvedBin, args: extraArgs } 交给 pty.spawn。
   * 用于启动交互式 shell（powershell/cmd/bash）—— 多一层 cmd 会让 Ctrl+C / Ctrl+Z 等
   * 控制字符的语义变形。此模式下 probe 必须保持 false（--version 是 Claude 专属探测）。
   */
  raw?: boolean;
}
```

把 `start()` 内这一行：

```ts
  const { file, args } = buildCommand(resolvedBin, sessionId, mode, env, extraArgs);
```

改为：

```ts
  // raw：交互式 shell 直通 spawn，不经 cmd.exe /c 包装，也不带 --session-id/--resume
  const { file, args } = opts.raw
    ? { file: resolvedBin, args: [...extraArgs] }
    : buildCommand(resolvedBin, sessionId, mode, env, extraArgs);
```

把 `resolveCmdExe` 改为导出：

```ts
export function resolveCmdExe(): string {
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --dir tests/main pty`
Expected: PASS（2 个测试都通过）

- [ ] **Step 5: 全量回归**

Run: `npm run test:main`
Expected: 全部通过，无新增失败

---

## Task 2: `shell.ts` 项目终端会话表

**Files:**
- Create: `src/main/shell.ts`
- Test: `tests/main/shell.test.ts`

**Interfaces:**
- Consumes: `pty.ts` 的 `start(cwd, sessionId, bin, mode, env, size, extraArgs, opts)`、`PtyMode.Auto`、`resolveCmdExe()`；`OutputBatcher` 的 `new OutputBatcher((id, data) => void)` / `push(id, chunk)` / `flush(id)` / `clear(id)`；`getBus()`；`getLogger()`
- Produces:
  - `pickShell(): string`
  - `ensure(sessionId: string, workDir: string, cols: number, rows: number): { ok: true; replay: string } | { ok: false; error: string }`
  - `write(sessionId: string, data: string): void`
  - `resize(sessionId: string, cols: number, rows: number): void`
  - `close(sessionId: string): void`
  - `rebind(oldId: string, newId: string): void`
  - `closeAll(): void`
  - `registerShellIpc(): void`
  - 事件：`shell:<sessionId>`（输出）、`shell:exit:<sessionId>`（`{ code: number }`）

- [ ] **Step 1: 写失败的测试**

创建 `tests/main/shell.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest';

// 与 pty.test.ts 同样的原因：CI 的 macOS runner 在 headless 下 posix_spawnp 会失败
const isCI = !!process.env.CI;

describe('shell', () => {
  afterEach(async () => {
    const mod = await import('../../src/main/shell.js');
    mod.closeAll();
  });

  it('pickShell 返回绝对路径', async () => {
    const { pickShell } = await import('../../src/main/shell.js');
    const sh = pickShell();
    expect(sh.length).toBeGreaterThan(0);
    if (process.platform === 'win32') {
      expect(sh).toMatch(/\.exe$/i);
    } else {
      expect(sh.startsWith('/')).toBe(true);
    }
  });

  it('ensure 对未知会话返回 ok=false 以外的合法结构', async () => {
    const { ensure } = await import('../../src/main/shell.js');
    // workDir 传一个不存在的目录：spawn 应失败并返回结构化错误，而不是抛异常
    const res = ensure('nonexistent-session', '/definitely/not/a/real/dir/lynel', 80, 24);
    expect(res).toHaveProperty('ok');
    if (!res.ok) expect(typeof res.error).toBe('string');
  });

  it.skipIf(isCI)('ensure 启动 shell，write 后能收到回显，close 后清理', { timeout: 30000 }, async () => {
    const mod = await import('../../src/main/shell.js');
    const { getBus } = await import('../../src/main/events.js');
    const sid = 'test-shell-1';
    const marker = 'LYNEL_SHELL_OK';

    const chunks: string[] = [];
    const onData = (data: string) => chunks.push(data);
    getBus().on(`shell:${sid}`, onData);

    const res = mod.ensure(sid, process.cwd(), 80, 24);
    expect(res.ok).toBe(true);

    const isWin = process.platform === 'win32';
    mod.write(sid, isWin ? `echo ${marker}\r` : `echo ${marker}\n`);

    await new Promise((r) => setTimeout(r, 10000));
    getBus().off(`shell:${sid}`, onData);

    expect(chunks.join('')).toContain(marker);
    mod.close(sid);
  });
});
```

- [ ] **Step 2: 运行测试确认它失败**

Run: `npx vitest run --dir tests/main shell`
Expected: FAIL —— `Failed to resolve import "../../src/main/shell.js"`（文件尚不存在）

- [ ] **Step 3: 实现 shell.ts**

创建 `src/main/shell.ts`：

```ts
// 项目终端：每个 Claude 会话一个独立的交互式 shell，cwd 绑定该会话的 workDir。
// 与 Claude 会话的 PTY（session.ts / app.ts 的 wirePty）完全隔离：本模块的输出走
// `shell:<sessionId>` 事件前缀，绝不能复用 `session:<sessionId>` —— 那会导致两个
// 终端的输出串流。
import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import { getBus } from './events.js';
import { getLogger } from './log.js';
import { start as startPty, PtyMode, resolveCmdExe, type PtyProcess } from './pty.js';
import { OutputBatcher } from './output-batcher.js';

const MAX_BUFFER = 64 * 1024;

export interface ShellSession {
  sessionId: string;
  workDir: string;
  proc: PtyProcess;
  buffer: string;
  cols: number;
  rows: number;
}

const shells = new Map<string, ShellSession>();

// 独立于 app.ts 的 ptyOutBatcher：那个实例的 flush 回调写死了 `session:` 前缀
const batcher = new OutputBatcher((sessionId, data) => {
  getBus().emit(`shell:${sessionId}`, data);
});

/**
 * 选择交互式 shell，返回**绝对路径**。
 * node-pty 的 native 侧对【相对】命令名会走自己的 PATH 解析，实现在某些机器上会
 * 丢 Path 末段或取不到超长 Path，解析为空就抛 `File not found:`（见 pty.ts 顶部
 * resolveCmdExe 的注释）。传绝对路径可完全绕开该解析。
 */
export function pickShell(): string {
  if (process.platform === 'win32') {
    const ps = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    if (fs.existsSync(ps)) return ps;
    return resolveCmdExe();
  }
  const fallback = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  return process.env.SHELL || fallback;
}

function appendBuffer(s: ShellSession, data: string): void {
  s.buffer += data;
  if (s.buffer.length > MAX_BUFFER) {
    s.buffer = s.buffer.slice(s.buffer.length - MAX_BUFFER);
  }
}

/** 启动或复用会话 shell。已有进程时回放缓冲，避免前端 xterm 重建后白屏。 */
export function ensure(
  sessionId: string,
  workDir: string,
  cols: number,
  rows: number,
): { ok: true; replay: string } | { ok: false; error: string } {
  const existing = shells.get(sessionId);
  if (existing) return { ok: true, replay: existing.buffer };

  try {
    const proc = startPty(
      workDir,
      '',
      pickShell(),
      PtyMode.Auto,
      {},
      { cols, rows },
      [],
      { raw: true },
    );
    const s: ShellSession = { sessionId, workDir, proc, buffer: '', cols, rows };
    shells.set(sessionId, s);

    proc.onData((data) => {
      appendBuffer(s, data);
      // 用 s.sessionId（可变）而非闭包捕获的 sessionId：rebind 后的事件要发到新 id
      batcher.push(s.sessionId, data);
    });
    proc.onExit((info) => {
      // 先 flush 掉窗口期内的残余输出，保证退出事件不越位
      batcher.flush(s.sessionId);
      getBus().emit(`shell:exit:${s.sessionId}`, { code: info.code });
      shells.delete(s.sessionId);
      batcher.clear(s.sessionId);
      getLogger().info(
        `[shell] exited sid=${s.sessionId.slice(0, 8)} code=${info.code} duration=${info.durationMs}ms`,
      );
    });

    getLogger().info(`[shell] started sid=${sessionId.slice(0, 8)} cwd=${workDir}`);
    return { ok: true, replay: '' };
  } catch (err: any) {
    const msg = err?.message || String(err);
    getLogger().error(`[shell] ensure failed sid=${sessionId.slice(0, 8)}: ${msg}`);
    return { ok: false, error: msg };
  }
}

export function write(sessionId: string, data: string): void {
  shells.get(sessionId)?.proc.write(data);
}

export function resize(sessionId: string, cols: number, rows: number): void {
  const s = shells.get(sessionId);
  if (!s) return;
  s.cols = cols;
  s.rows = rows;
  s.proc.resize(cols, rows);
}

export function close(sessionId: string): void {
  const s = shells.get(sessionId);
  if (!s) return;
  s.proc.kill();
  shells.delete(sessionId);
  batcher.clear(sessionId);
}

/** Claude /clear 场景：把终端迁到新 sessionId，不 kill 进程，保留 buffer */
export function rebind(oldId: string, newId: string): void {
  const s = shells.get(oldId);
  if (!s) return;
  // 先把窗口期内的残余按旧 id 发掉，避免 pending 残留
  batcher.flush(oldId);
  shells.delete(oldId);
  s.sessionId = newId;
  shells.set(newId, s);
}

export function closeAll(): void {
  for (const id of Array.from(shells.keys())) close(id);
}

export function registerShellIpc(): void {
  ipcMain.handle(
    'shell:ensure',
    (_e, sessionId: string, workDir: string, cols: number, rows: number) =>
      ensure(sessionId, workDir, cols, rows),
  );
  ipcMain.handle('shell:write', (_e, sessionId: string, data: string) => write(sessionId, data));
  ipcMain.handle('shell:resize', (_e, sessionId: string, cols: number, rows: number) =>
    resize(sessionId, cols, rows),
  );
  ipcMain.handle('shell:close', (_e, sessionId: string) => close(sessionId));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --dir tests/main shell`
Expected: PASS（3 个测试；CI 下第三个被 skip）

- [ ] **Step 5: 全量回归**

Run: `npm run test:main`
Expected: 全部通过

---

## Task 3: 主进程接线 + IPC 转发层

**Files:**
- Modify: `src/main/app.ts`（import 区约 29 行；`setOnRemove` 回调 475-478 行；`registerIpcHandlers` 1394-1396 行；`doRebindSession` 约 2323 行；`shutdown()`）
- Modify: `src/main/preload.ts`（`api` 对象内追加）
- Modify: `src/renderer/src/composables/useElectron.ts`（追加导出）

**Interfaces:**
- Consumes: `shell.ts` 的 `registerShellIpc` / `close` / `rebind` / `closeAll`
- Produces（渲染层）：
  - `ShellEnsure(sessionId, workDir, cols, rows): Promise<{ ok: boolean; replay?: string; error?: string }>`
  - `ShellWrite(sessionId, data): Promise<void>`
  - `ShellResize(sessionId, cols, rows): Promise<void>`
  - `ShellClose(sessionId): Promise<void>`

**关键约束**：`session.setOnRemove`（`session.ts:35-37`）是**单回调**，`app.ts:475` 已经注册过一个。必须在该回调**内部追加**，再调一次 `setOnRemove` 会覆盖掉 wecom / batcher 的清理逻辑。

- [ ] **Step 1: 在 app.ts 追加 import**

在 `src/main/app.ts:29`（`import { registerFilesIpc } from './files.js';`）之后追加：

```ts
import {
  registerShellIpc,
  close as closeShell,
  rebind as rebindShell,
  closeAll as closeAllShells,
} from './shell.js';
```

- [ ] **Step 2: 在现有 setOnRemove 回调里追加 shell 清理**

把 `src/main/app.ts:475-478`：

```ts
    session.setOnRemove((id) => {
      this.wecomChannel.clearSessionMappings(id);
      this.ptyOutBatcher.clear(id);
    });
```

改为：

```ts
    session.setOnRemove((id) => {
      this.wecomChannel.clearSessionMappings(id);
      this.ptyOutBatcher.clear(id);
      // 会话删除时一并关掉它的项目终端，否则 shell PTY 会泄漏成孤儿进程
      closeShell(id);
    });
```

- [ ] **Step 3: 注册 shell IPC**

把 `src/main/app.ts:1394-1396`：

```ts
  private registerIpcHandlers(): void {
    registerTraceIpc();
    registerFilesIpc();
```

改为：

```ts
  private registerIpcHandlers(): void {
    registerTraceIpc();
    registerFilesIpc();
    registerShellIpc();
```

- [ ] **Step 4: 在 doRebindSession 里迁移 shell**

在 `src/main/app.ts` 的 `doRebindSession`（约 2323 行起）方法体内，紧随 `const s = session.rebind(oldId, newId, workDir);` 及其后的 early-return 判断之后（即确认 rebind 成功、拿到 `s` 之后）插入：

```ts
    // 项目终端跟着用户走：/clear 换了 sessionId，但用户不该看到终端被重置
    rebindShell(oldId, newId);
```

> 落点要求：必须在 `session.rebind` 成功之后。若 `session.rebind` 返回 undefined 时该方法会提前 return，shell 也应保持不动 —— 把这一行放在 early-return 之后即可自然满足。

- [ ] **Step 5: 在 App.shutdown 里关闭全部 shell**

找到 `src/main/app.ts` 中 `App` 类的 `shutdown()` 方法（`index.ts:207` 调用它）。在其方法体**最早处**插入：

```ts
    // 应用退出前杀干净项目终端，避免 shell PTY 变成孤儿进程
    closeAllShells();
```

- [ ] **Step 6: preload 转发**

在 `src/main/preload.ts` 的 `api` 对象内、`fileUnwatch` 那一行之后追加：

```ts
  shellEnsure: (sessionId: string, workDir: string, cols: number, rows: number) =>
    ipcRenderer.invoke('shell:ensure', sessionId, workDir, cols, rows),
  shellWrite: (sessionId: string, data: string) =>
    ipcRenderer.invoke('shell:write', sessionId, data),
  shellResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('shell:resize', sessionId, cols, rows),
  shellClose: (sessionId: string) => ipcRenderer.invoke('shell:close', sessionId),
```

类型由文件末尾的 `export type ElectronAPI = typeof api;` 自动推导，无需额外声明。

- [ ] **Step 7: useElectron 类型化导出**

在 `src/renderer/src/composables/useElectron.ts` 末尾（`export const isElectronDev = import.meta.env.DEV;` 之前）追加：

```ts
// 项目终端（每会话一个 shell）
export const ShellEnsure = (sessionId: string, workDir: string, cols: number, rows: number) =>
  api().shellEnsure(sessionId, workDir, cols, rows) as Promise<{
    ok: boolean
    replay?: string
    error?: string
  }>
export const ShellWrite = (sessionId: string, data: string) => api().shellWrite(sessionId, data)
export const ShellResize = (sessionId: string, cols: number, rows: number) =>
  api().shellResize(sessionId, cols, rows)
export const ShellClose = (sessionId: string) => api().shellClose(sessionId)
```

- [ ] **Step 8: 验证编译与测试**

Run: `npm run test:main && npx tsc --noEmit -p tsconfig.json`
Expected: 测试全通过；主进程类型检查无错误

> 说明：根项目没有 `typecheck` 脚本，直接用 `npx tsc --noEmit -p tsconfig.json` 做一次类型校验。`npm run build:electron` 也会跑 `tsc`，但会产出文件 —— 用 `--noEmit` 更干净。

- [ ] **Step 9: 端到端手测**

Run: `npm run dev`

在渲染进程 DevTools console 里执行下面的片段。

> 这几行是**一次性手测代码**，不进仓库，所以直接调 `window.electronAPI` 而不是经 `useElectron.ts` —— 全局约定约束的是提交进仓库的组件代码。

```js
// 1. 先订阅输出（必须先订阅，否则看不到后续回显）
window.electronAPI.eventsOn('shell:manual-test-1', (d) => console.log('[shell]', d))
// 2. 启动 shell。任意 id + 一个真实存在的目录即可：shell:ensure 不校验 session 是否存在。
//    Windows 用 'C:\\'，macOS / Linux 用 '/'
const res = await window.electronAPI.shellEnsure('manual-test-1', 'C:\\', 80, 24)
console.log(res)          // 期望 { ok: true, replay: '' }
// 3. 写命令，第 1 步的回调应打印出 shell 回显
await window.electronAPI.shellWrite('manual-test-1', 'echo hello\r')
// 4. 收尾
await window.electronAPI.shellClose('manual-test-1')
```

Expected: `res.ok === true`；`[shell]` 开头的日志里能看到 `hello` 回显。此步只验证 IPC 打通，不需要观察到界面。

---

## Task 4: 抽出 `terminal/theme.ts`（纯重构）

**Files:**
- Create: `src/renderer/src/terminal/theme.ts`
- Modify: `src/renderer/src/components/XtermTerminal.vue`（删除本地实现，改 import）

**Interfaces:**
- Consumes: `@xterm/xterm` 的 `Terminal` 类型；`../types/settings` 的 `TerminalTheme` 类型
- Produces: `THEME_VARS`、`applyThemeSync(theme: TerminalTheme): Record<string, string>`、`waitForFontReady(family: string, size: number): Promise<void>`、`scheduleThemeSync(t: Terminal, theme: TerminalTheme): void`

**这是纯重构**，`XtermTerminal.vue` 的行为必须完全不变。

- [ ] **Step 1: 创建 theme.ts**

创建 `src/renderer/src/terminal/theme.ts`：

```ts
// 终端主题工具：从 CSS 变量（html 上的 --term-*）读取颜色构建 xterm theme 对象。
// XtermTerminal.vue（Claude 会话终端）与 ProjectTerminal.vue（项目终端）共用同一份实现，
// 保证两个终端的配色永远一致。
import type { Terminal } from '@xterm/xterm'
import type { TerminalTheme } from '../types/settings'

/** 一次 getComputedStyle 内读全部 xterm 主题变量，合并多次 layout 为 1 次 */
export const THEME_VARS = [
  ['background', '--term-bg'],
  ['foreground', '--term-fg'],
  ['cursor', '--term-cursor'],
  ['cursorAccent', '--term-cursor-accent'],
  ['selectionBackground', '--term-selection'],
  ['selectionForeground', '--term-fg'],
  ['selectionInactiveBackground', '--term-selection'],
  ['black', '--term-black'],
  ['red', '--term-red'],
  ['green', '--term-green'],
  ['yellow', '--term-yellow'],
  ['blue', '--term-blue'],
  ['magenta', '--term-magenta'],
  ['cyan', '--term-cyan'],
  ['white', '--term-white'],
  ['brightBlack', '--term-bright-black'],
  ['brightRed', '--term-bright-red'],
  ['brightGreen', '--term-bright-green'],
  ['brightYellow', '--term-bright-yellow'],
  ['brightBlue', '--term-bright-blue'],
  ['brightMagenta', '--term-bright-magenta'],
  ['brightCyan', '--term-bright-cyan'],
  ['brightWhite', '--term-bright-white'],
] as const

/**
 * 同步应用 theme：setAttribute data-term-theme + 一次 getComputedStyle 读全部主题变量。
 * 给 init（同步用）和 scheduleThemeSync（rAF 内用）共用，避免两处重复实现。
 */
export function applyThemeSync(theme: TerminalTheme): Record<string, string> {
  document.documentElement.setAttribute('data-term-theme', theme)
  const style = getComputedStyle(document.documentElement)
  const themeObj: Record<string, string> = {}
  for (const [key, varName] of THEME_VARS) {
    themeObj[key] = style.getPropertyValue(varName).trim() || '#000'
  }
  return themeObj
}

/** 等待指定字体可用。否则 fitAddon 测出来的 char width 是回退字体的，会算出错误的 cols/rows */
export async function waitForFontReady(family: string, size: number): Promise<void> {
  if (!document.fonts?.load) return
  // 解析 font-family 字符串，取第一个引号名作为优先字体
  const first = family.split(',')[0].trim().replace(/^["']|["']$/g, '')
  if (!first || first === 'monospace') return
  try {
    await document.fonts.load(`${size}px ${first}`)
  } catch {
    // 字体加载失败也不阻塞终端初始化，用回退字体也能用
  }
}

/** rAF 节流：合并同一帧内的多次 theme 同步，避免快速点击触发连续 22 次 reflow */
let pendingThemeSync: { t: Terminal; theme: TerminalTheme } | null = null
let themeSyncRaf = 0
export function scheduleThemeSync(t: Terminal, theme: TerminalTheme) {
  pendingThemeSync = { t, theme }
  if (themeSyncRaf) return
  themeSyncRaf = requestAnimationFrame(() => {
    themeSyncRaf = 0
    const job = pendingThemeSync
    pendingThemeSync = null
    if (!job) return
    job.t.options.theme = applyThemeSync(job.theme) as any
    // xterm 不会自动用新 theme 重绘已有 buffer；必须显式 refresh 才能让已显示的字符换色
    job.t.refresh(0, job.t.rows - 1)
  })
}
```

- [ ] **Step 2: 改 XtermTerminal.vue 引入这些函数**

在 `src/renderer/src/components/XtermTerminal.vue` 中：

1. 删除 `THEME_VARS` 常量定义（原 52-76 行）与 `applyThemeSync`（82-90 行）、`waitForFontReady`（93-103 行）、`scheduleThemeSync` 及其模块级 `pendingThemeSync` / `themeSyncRaf`（105-120 行）。
2. 在 import 区追加：

```ts
import { THEME_VARS, applyThemeSync, waitForFontReady, scheduleThemeSync } from '../terminal/theme'
```

3. 确认文件内不再有对 `THEME_VARS` 的直接引用（它只被 `applyThemeSync` 内部使用，若删除后出现「未使用」告警，从 import 里去掉 `THEME_VARS`）。

- [ ] **Step 3: 验证类型检查通过**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 验证行为未变**

Run: `npm run dev`

打开一个会话的终端页，确认：
1. 终端能正常渲染、输入回显正常
2. 在「设置 → 外观」切换终端主题，终端颜色立即跟随变化（这是 `scheduleThemeSync` 的路径）
3. 切换终端字号，内容重新换行且不丢历史（`applyTerminalConfig` 的 refit 路径）

Expected: 三项表现与改动前完全一致。

---

## Task 5: `files` store 暴露响应式 `currentSessionId`

**Files:**
- Modify: `src/renderer/src/stores/files.ts`

**Interfaces:**
- Consumes: 无
- Produces: `useFilesStore()` 新增响应式字段 `currentSessionId: Ref<string>`

**背景**：`CodeView` 与 `BottomPanel` 需要响应式感知会话切换，以便重建项目终端。当前 `lastSessionId`（`files.ts:42`）是模块级普通变量，改动它不会触发组件重渲染。

- [ ] **Step 1: 提升为 ref**

`src/renderer/src/stores/files.ts` 第 42 行：

```ts
  // 当前已加载现场的会话 id（'' = 无）。setSession 切走时先保存现场到该槽位。
  let lastSessionId = ''
```

改为：

```ts
  // 当前已加载现场的会话 id（'' = 无）。setSession 切走时先保存现场到该槽位。
  // 用 ref 而非普通变量：CodeView / BottomPanel 需响应式感知会话切换来重建终端。
  const currentSessionId = ref('')
```

- [ ] **Step 2: 替换 setSession 内的引用**

`setSession` 方法内有 4 处 `lastSessionId`，逐一改为 `currentSessionId.value`：

```ts
    // 同一会话重复设置：现场已就绪，直接返回避免误清
    if (currentSessionId.value === id && workDir.value === wd) return
    // 1. 保存当前会话现场（仅当确实有会话在场）
    if (currentSessionId.value && workDir.value) {
      sessionState.value = {
        ...sessionState.value,
        [currentSessionId.value]: {
          openFiles: openFiles.value.map((o) => ({ ...o })),
          drafts: { ...drafts.value },
          activeRelPath: activeRelPath.value,
          expanded: [...expanded.value],
        },
      }
    }
    // 2. 切换工作目录：unwatch 旧目录
    if (workDir.value) await FileUnwatch(workDir.value).catch(() => {})
    workDir.value = wd
    currentSessionId.value = id
```

- [ ] **Step 3: 替换 forgetSession 内的引用**

```ts
  /** 会话删除时清理其现场快照，避免泄漏 */
  function forgetSession(sid: string) {
    // 关闭的是当前加载的会话时，同步失效现场标记，避免延后 watch 触发的
    // setSession 把快照重新保存回来（越删越回填导致泄漏）
    if (sid === currentSessionId.value) currentSessionId.value = ''
    if (!(sid in sessionState.value)) return
    const next = { ...sessionState.value }
    delete next[sid]
    sessionState.value = next
  }
```

- [ ] **Step 4: 在 store 的 return 里导出**

把文件末尾（`files.ts:259-265`）的：

```ts
  return {
    workDir, tree, expanded, openFiles, drafts, activeRelPath, collapsed, rootCreateRequest,
```

改为：

```ts
  return {
    workDir, currentSessionId, tree, expanded, openFiles, drafts, activeRelPath, collapsed, rootCreateRequest,
```

（其余行不变。）

- [ ] **Step 5: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无错误。若还有遗漏的 `lastSessionId` 引用，此处会报 `Cannot find name 'lastSessionId'`。

回归确认（`npm run dev`）：打开文件、切换会话时编辑器 tab 的重置行为应无变化 —— 本次改动只是把同一个值换成响应式容器。

---

## Task 6: `ProjectTerminal.vue`

**Files:**
- Create: `src/renderer/src/components/code/ProjectTerminal.vue`

**Interfaces:**
- Consumes: `useElectron.ts` 的 `ShellEnsure` / `ShellWrite` / `ShellResize` / `EventsOn`；`terminal/theme.ts` 的 `applyThemeSync` / `waitForFontReady` / `scheduleThemeSync`；`stores/settings.ts` 的 `useSettingsStore`；`types/settings.ts` 的 `defaultTerminalConfig`
- Produces: 组件 props `{ sessionId: string; workDir: string; visible: boolean }`

**设计要点**：卸载时**不**调用 `ShellClose` —— 组件因切会话或折叠而卸载时，PTY 必须保留，重开靠 `ShellEnsure` 返回的 `replay` 回放。PTY 的销毁由主进程的会话生命周期（Task 3 Step 2/5）负责。

- [ ] **Step 1: 创建组件**

创建 `src/renderer/src/components/code/ProjectTerminal.vue`：

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import Icon from '../Icon.vue'
import {
  EventsOn,
  ShellEnsure,
  ShellWrite,
  ShellResize,
} from '../../composables/useElectron'
import { useSettingsStore } from '../../stores/settings'
import { defaultTerminalConfig } from '../../types/settings'
import { applyThemeSync, waitForFontReady, scheduleThemeSync } from '../../terminal/theme'

const props = defineProps<{
  sessionId: string
  workDir: string
  visible: boolean
}>()

const settings = useSettingsStore()
const hostEl = ref<HTMLElement | null>(null)
const exited = ref(false)
const errorMsg = ref('')

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let cleanups: (() => void)[] = []
let lastCols = 0
let lastRows = 0

function disposeTerm() {
  for (const fn of cleanups) {
    try { fn() } catch { /* 忽略 */ }
  }
  cleanups = []
  resizeObserver?.disconnect()
  resizeObserver = null
  term?.dispose()
  term = null
  fitAddon = null
  lastCols = 0
  lastRows = 0
  if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null }
}

function fitAndResize() {
  if (!term || !hostEl.value || !props.visible) return
  if (hostEl.value.clientWidth <= 0 || hostEl.value.clientHeight <= 0) return
  fitAddon?.fit()
  if (term.cols === 0 || term.rows === 0) return
  term.refresh(0, term.rows - 1)
  if (term.cols === lastCols && term.rows === lastRows) return
  lastCols = term.cols
  lastRows = term.rows
  void ShellResize(props.sessionId, term.cols, term.rows).catch(() => {})
}

async function init() {
  if (term || !hostEl.value) return
  if (!settings.cfg) await settings.load()

  const cfg = settings.cfg?.terminal ?? defaultTerminalConfig()
  // 创建 Terminal 前同步应用 theme，避免首帧颜色错误
  const themeObj = applyThemeSync(cfg.theme)
  await waitForFontReady(cfg.fontFamily, cfg.fontSize)
  if (!hostEl.value) return

  term = new Terminal({
    cursorBlink: cfg.cursorBlink,
    cursorStyle: cfg.cursorStyle,
    cursorWidth: 2,
    fontSize: cfg.fontSize,
    fontFamily: cfg.fontFamily,
    lineHeight: cfg.lineHeight,
    allowProposedApi: true,
    scrollback: cfg.scrollback,
    theme: themeObj as any,
  })
  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(hostEl.value)

  // 等两帧布局，让 xterm 的 char size 测量稳定后再 fit
  await new Promise((r) => requestAnimationFrame(r))
  await new Promise((r) => requestAnimationFrame(r))
  fitAddon.fit()

  term.onData((data: string) => {
    void ShellWrite(props.sessionId, data).catch(() => {})
  })

  cleanups.push(EventsOn(`shell:${props.sessionId}`, (data: string) => term?.write(data)))
  cleanups.push(EventsOn(`shell:exit:${props.sessionId}`, () => { exited.value = true }))

  // 主题跟随设置变化
  cleanups.push(watch(
    () => settings.cfg?.terminal.theme,
    (t) => { if (term && t) scheduleThemeSync(term, t) },
  ))

  resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(fitAndResize, 150)
  })
  resizeObserver.observe(hostEl.value)

  const res = await ShellEnsure(props.sessionId, props.workDir, term.cols, term.rows)
  if (!res.ok) {
    errorMsg.value = res.error ?? '启动终端失败'
    return
  }
  if (res.replay) term.write(res.replay)
  term.focus()
}

async function restart() {
  if (!term) return
  exited.value = false
  errorMsg.value = ''
  term.reset()
  const res = await ShellEnsure(props.sessionId, props.workDir, term.cols, term.rows)
  if (!res.ok) {
    errorMsg.value = res.error ?? '启动终端失败'
    return
  }
  if (res.replay) term.write(res.replay)
  term.focus()
}

// 会话切换：重建 xterm（PTY 保留在主进程，靠 replay 回放）
watch(() => props.sessionId, async () => {
  disposeTerm()
  exited.value = false
  errorMsg.value = ''
  await nextTick()
  await init()
})

// 面板/标签重新可见：容器尺寸可能已变，补一次 fit
watch(() => props.visible, async (v) => {
  if (!v) return
  await nextTick()
  await new Promise((r) => requestAnimationFrame(r))
  fitAndResize()
  term?.focus()
})

onMounted(async () => {
  await nextTick()
  await init()
})

onBeforeUnmount(() => {
  // 只销毁前端实例；PTY 由主进程按会话生命周期管理，重开时靠 replay 回放
  disposeTerm()
})
</script>

<template>
  <div class="project-terminal">
    <div ref="hostEl" class="term-host" />
    <div v-if="errorMsg" class="term-mask">
      <div class="mask-text">{{ errorMsg }}</div>
      <button class="mask-btn" @click="restart">重试</button>
    </div>
    <div v-else-if="exited" class="term-mask">
      <div class="mask-text">终端进程已退出</div>
      <button class="mask-btn" @click="restart">
        <Icon name="rotate-ccw" :size="13" /> 重新启动
      </button>
    </div>
  </div>
</template>

<style scoped>
.project-terminal {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.term-host {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.term-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  background: var(--term-bg);
}
.mask-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid var(--code-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--fs-caption);
  cursor: pointer;
}
.mask-btn:hover { background: var(--code-hover); }
.term-host :deep(.xterm-viewport)::-webkit-scrollbar { width: 8px; }
.term-host :deep(.xterm-viewport)::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 4px;
}
</style>
```

> 样式里用到的 `--term-bg` / `--code-border` / `--code-hover` 都是 `CodeView.vue:120-137` 已在 `.code-view` 作用域内重映射过的变量，`ProjectTerminal` 作为其子组件可直接继承。

- [ ] **Step 2: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 手动验证（临时挂载）**

`BottomPanel` 尚未存在，先临时接入以便手测。

1. 在 `CodeView.vue` 的 import 区追加：

```ts
import ProjectTerminal from './ProjectTerminal.vue'
```

2. 在模板的 `<section class="editor-panel">` 内、`<CodeEditor />` 之后插入：

```vue
<ProjectTerminal
  :session-id="store.currentSessionId"
  :work-dir="store.workDir"
  :visible="true"
/>
```

（这段临时挂载与 import 会在 Task 7 里被移除 —— `ProjectTerminal` 改由 `BottomPanel` 挂载。）

Run: `npm run dev`，打开一个会话 → 文件子页

Expected:
1. 终端渲染出来，显示 PowerShell / zsh 提示符
2. 能输入命令并看到输出（如 `ls` / `dir`）
3. 切到「终端」子页再切回「文件」子页，终端内容仍在（PTY 未重启）
4. 切换 Claude 会话再切回，终端内容通过 replay 恢复

- [ ] **Step 4: 撤销临时挂载**

删除 Step 3 加入的那段临时模板与 import（Task 7 会正式接入）。

---

## Task 7: `BottomPanel.vue` + 接入 `CodeView`

**Files:**
- Create: `src/renderer/src/components/code/BottomPanel.vue`
- Modify: `src/renderer/src/components/code/CodeView.vue`

**Interfaces:**
- Consumes: `ProjectTerminal.vue`；`useFilesStore` 的 `workDir` / `currentSessionId`（Task 5 已就绪）
- Produces: `BottomPanel.vue` props `{ sessionId: string; workDir: string }`

- [ ] **Step 1: 创建 BottomPanel.vue**

创建 `src/renderer/src/components/code/BottomPanel.vue`：

```vue
<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import Icon from '../Icon.vue'
import ProjectTerminal from './ProjectTerminal.vue'

const props = defineProps<{
  sessionId: string
  workDir: string
}>()

const HEIGHT_KEY = 'lynel:code-bottom-height'
const COLLAPSED_KEY = 'lynel:code-bottom-collapsed'
const MIN_HEIGHT = 120
const DEFAULT_HEIGHT = 320

function maxHeight(): number {
  return Math.round(window.innerHeight * 0.7)
}

function loadHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY))
    if (Number.isFinite(v) && v >= MIN_HEIGHT) return Math.min(v, maxHeight())
  } catch { /* localStorage 不可用则用默认值 */ }
  return DEFAULT_HEIGHT
}

const height = ref(loadHeight())
const collapsed = ref(localStorage.getItem(COLLAPSED_KEY) === '1')
// Phase 2 会把 'git' 加进来；现在只有终端
const activeTab = ref<'terminal'>('terminal')

// ---------- 拖高（面板上边缘） ----------
const dragging = ref(false)
let startY = 0
let startHeight = 0

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  startY = e.clientY
  startHeight = height.value
  dragging.value = true
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  if (!dragging.value) return
  // 上边缘向上拖 = 变高，故用减法
  const next = startHeight - (e.clientY - startY)
  height.value = Math.min(maxHeight(), Math.max(MIN_HEIGHT, next))
}

function onResizeEnd() {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.userSelect = ''
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  try { localStorage.setItem(HEIGHT_KEY, String(height.value)) } catch { /* 忽略 */ }
}

function toggleCollapse() {
  collapsed.value = !collapsed.value
  try { localStorage.setItem(COLLAPSED_KEY, collapsed.value ? '1' : '0') } catch { /* 忽略 */ }
}

onBeforeUnmount(() => {
  if (dragging.value) onResizeEnd()
})
</script>

<template>
  <section
    class="bottom-panel"
    :class="{ dragging, collapsed }"
    :style="{ height: collapsed ? '32px' : height + 'px' }"
  >
    <div v-if="!collapsed" class="panel-resize-handle" @mousedown.prevent="onResizeStart" />
    <div class="panel-bar">
      <button
        class="panel-tab"
        :class="{ active: activeTab === 'terminal' }"
        @click="activeTab = 'terminal'"
      >
        <Icon name="terminal" :size="13" /> 终端
      </button>
      <span class="bar-spacer" />
      <button
        class="bar-btn"
        :title="collapsed ? '展开面板' : '折叠面板'"
        :aria-label="collapsed ? '展开面板' : '折叠面板'"
        @click="toggleCollapse"
      >
        <Icon :name="collapsed ? 'chevron-up' : 'chevron-down'" :size="14" />
      </button>
    </div>
    <!-- v-show 而非 v-if：终端实例必须常驻，切走再切回不能丢 buffer / 重建 PTY -->
    <div v-show="!collapsed" class="panel-body">
      <ProjectTerminal
        :session-id="props.sessionId"
        :work-dir="props.workDir"
        :visible="!collapsed && activeTab === 'terminal'"
      />
    </div>
  </section>
</template>

<style scoped>
.bottom-panel {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}
.bottom-panel.dragging { cursor: row-resize; }
.panel-resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  cursor: row-resize;
  z-index: 5;
  background: transparent;
}
.panel-resize-handle:hover { background: var(--accent); }
.panel-bar {
  height: 32px;
  min-height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
  border-bottom: 1px solid var(--border);
  user-select: none;
}
.panel-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-caption);
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}
.panel-tab:hover { color: var(--text-primary); background: var(--bg-hover); }
.panel-tab.active { color: var(--text-primary); background: var(--code-hover); }
.bar-spacer { flex: 1; }
.bar-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}
.bar-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
</style>
```

- [ ] **Step 2: 接入 CodeView**

`src/renderer/src/components/code/CodeView.vue`：

1. 在 import 区（约 5 行 `import CodeEditor from './CodeEditor.vue'` 之后）追加：

```ts
import BottomPanel from './BottomPanel.vue'
```

2. 把模板里的编辑器区（`CodeView.vue:111-114`）：

```vue
    <section class="editor-panel">
      <FileTabs />
      <CodeEditor />
    </section>
```

改为外层包一个纵向 flex 容器，编辑器在上、面板在下：

```vue
    <div class="main-column">
      <section class="editor-panel">
        <FileTabs />
        <CodeEditor />
      </section>
      <BottomPanel :session-id="store.currentSessionId" :work-dir="store.workDir" />
    </div>
```

3. 在 `<style scoped>` 里追加（`CodeView` 根已是横向 flex，这里补一层纵向容器）：

```css
.main-column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

> 注意：`.editor-panel` 已有 `flex: 1; min-height: 0;`，放进 `.main-column` 后会自动占据面板之上的剩余高度，无需改动其规则。

- [ ] **Step 3: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 手动验证**

Run: `npm run dev`，打开会话 → 「文件」子页

逐项确认：
1. 底部出现「终端」面板，显示 shell 提示符，可输入命令并有输出
2. 拖面板上边缘能调整高度；松手后重新进入该子页，高度保持（localStorage 持久化）
3. 点右侧 chevron 能折叠成 32px 标签条，再点能展开
4. 折叠前后终端内容不丢（`v-show` 而非 `v-if`）
5. 切换 Claude 会话，终端切换到对应会话的 shell（各自独立，内容不串）
6. 切换「终端 / Trace / 文件」子页，回到「文件」时终端内容仍在
7. 终端里 `cd` 到某目录后切走再切回，replay 内容完整

- [ ] **Step 5: 全量回归**

Run: `npm run test:main && cd src/renderer && npx vue-tsc --noEmit`
Expected: 全部通过

---

## 完成标准

Phase 1 完成的判定：

1. 每个 Claude 会话在「文件」子页底部有独立的交互式 shell，cwd 为其 workDir
2. 面板可拖高（120px–70% 视口高）、可折叠，状态持久化
3. 会话切换、子页切换、面板折叠都不丢终端内容
4. 会话被删除 / 应用退出时，shell PTY 被正确回收（无孤儿进程）
5. `/clear` 触发 rebind 后，终端跟着迁移到新 sessionId，内容保持
6. `npm run test:main` 与 `cd src/renderer && npx vue-tsc --noEmit` 全绿
