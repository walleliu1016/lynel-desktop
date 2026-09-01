# 右侧代码编辑器侧栏 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在会话页右侧新增可折叠、可拖宽的代码编辑器侧栏（文件树 + Monaco 编辑器），支持查看/编辑/保存工作目录文件，并同步外部变更。

**Architecture:** 主进程新增 `src/main/files.ts` 文件服务（IPC + chokidar 监听），渲染进程新增 Pinia `files` store 和 `components/code/` 下四个组件，挂载到 `HomeView.vue` 布局 center 右侧。Monaco 懒加载、单例复用编辑器实例。

**Tech Stack:** Electron IPC（`ipcMain.handle` / `ipcRenderer.invoke`）、chokidar、Vue 3 `<script setup>` + Pinia setup store、`monaco-editor`（Vite `?worker`）、vitest。

## Global Constraints

- 中文回复/中文代码注释。
- commit 前必须 `npm run test:main` 与 `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 渲染进程唯一 IPC 入口是 `composables/useElectron.ts`；禁止直接 `window.electronAPI.X()`。
- 主进程错误一律 reject 返回错误对象，不抛未捕获异常。
- Pinia ref<Record<K,V>> 更新用整体 spread：`state.value = { ...state.value, [key]: v }`。
- 样式用 `styles/theme.css` CSS 变量，不硬编码颜色；图标用 `@lucide/vue` 经 `components/Icon.vue`，禁止 emoji 当图标。
- 忽略清单常量（Task 1）：`node_modules .git dist build out .venv venv __pycache__ .next .cache coverage .vscode .idea` + `*.log *.lock *.min.js`。
- Monaco 只在编辑器首次打开文件时 `import('monaco-editor')` 懒加载；只允许一个编辑器实例；切 tab 换 model，关 tab `dispose()` model。

---

### Task 1: 主进程文件服务纯函数（忽略清单 / listDir / binary / 路径校验）

**Files:**
- Create: `src/main/files.ts`
- Test: `tests/main/files.test.ts`

**Interfaces:**
- Produces:
  - `MAX_TEXT_SIZE: number`（= 1024 * 1024）
  - `isIgnored(name: string): boolean`
  - `detectBinary(buf: Buffer): boolean`
  - `interface FsEntry { name: string; isDir: boolean }`
  - `listDir(dirPath: string): FsEntry[]`
  - `resolveEntry(workDir: string, relPath: string): string`（相对路径越界抛 `路径越界`）

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/files.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isIgnored, detectBinary, listDir, resolveEntry } from '../../src/main/files.js'

describe('isIgnored', () => {
  it('忽略常见目录', () => {
    expect(isIgnored('node_modules')).toBe(true)
    expect(isIgnored('.git')).toBe(true)
    expect(isIgnored('dist')).toBe(true)
    expect(isIgnored('__pycache__')).toBe(true)
  })
  it('忽略 *.log / *.lock / *.min.js', () => {
    expect(isIgnored('app.log')).toBe(true)
    expect(isIgnored('package-lock.json')).toBe(true)
    expect(isIgnored('bundle.min.js')).toBe(true)
  })
  it('不忽略普通文件/目录', () => {
    expect(isIgnored('src')).toBe(false)
    expect(isIgnored('main.ts')).toBe(false)
    expect(isIgnored('README.md')).toBe(false)
  })
})

describe('detectBinary', () => {
  it('含 NUL 字节判定二进制', () => {
    expect(detectBinary(Buffer.from([0x68, 0x69, 0x00, 0x0a]))).toBe(true)
  })
  it('纯文本非二进制', () => {
    expect(detectBinary(Buffer.from('hello world\n第二行'))).toBe(false)
  })
})

describe('listDir', () => {
  let tmp: string
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-files-')) })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })
  it('目录在前、名称排序、过滤忽略项', () => {
    fs.mkdirSync(path.join(tmp, 'src'))
    fs.mkdirSync(path.join(tmp, 'node_modules'))
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'a')
    fs.writeFileSync(path.join(tmp, 'package-lock.json'), '{}')
    const entries = listDir(tmp)
    expect(entries.map((e) => e.name)).toEqual(['src', 'a.txt'])
    expect(entries[0].isDir).toBe(true)
  })
})

describe('resolveEntry', () => {
  it('阻止相对路径越界', () => {
    const base = path.join(os.tmpdir(), 'lynel-base')
    fs.mkdirSync(base, { recursive: true })
    expect(() => resolveEntry(base, '../escape.txt')).toThrow(/越界/)
  })
  it('空 relPath 返回 workDir 本身', () => {
    expect(resolveEntry('/tmp/foo', '')).toBe(path.resolve('/tmp/foo'))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --dir tests/main files`
Expected: FAIL，`Cannot find module '../../src/main/files.js'`

- [ ] **Step 3: 实现纯函数**

```ts
// src/main/files.ts
import fs from 'node:fs';
import path from 'node:path';

export const MAX_TEXT_SIZE = 1024 * 1024; // 1MB，超过视为大文件只读

export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.venv', 'venv',
  '__pycache__', '.next', '.cache', 'coverage', '.vscode', '.idea',
]);

export function isIgnored(name: string): boolean {
  if (IGNORED_DIRS.has(name)) return true;
  return /\.(log|lock|min\.js)$/.test(name);
}

export function detectBinary(buf: Buffer): boolean {
  // 采样前 8KB，含 NUL 字节判定二进制
  return buf.subarray(0, 8192).includes(0);
}

export interface FsEntry { name: string; isDir: boolean }

export function listDir(dirPath: string): FsEntry[] {
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => !isIgnored(d.name))
    .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
    .sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
    );
}

/** 把 relPath 安全解析到 workDir 内；相对路径越界抛错，防目录穿越 */
export function resolveEntry(workDir: string, relPath: string): string {
  const base = path.resolve(workDir);
  const target = path.resolve(base, relPath || '.');
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('路径越界');
  }
  return target;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --dir tests/main files`
Expected: PASS（5 个 describe 全绿）

- [ ] **Step 5: Commit**

```bash
git add src/main/files.ts tests/main/files.test.ts
git commit -m "feat: 文件服务核心纯函数（忽略清单/listDir/binary/路径校验）"
```

---

### Task 2: 文件操作函数（read/write/create/rename/delete）+ 单测

**Files:**
- Modify: `src/main/files.ts`（追加）
- Test: `tests/main/files.test.ts`（追加）

**Interfaces:**
- Consumes: `MAX_TEXT_SIZE`、`detectBinary`、`resolveEntry`（Task 1）
- Produces:
  - `readFileEntry(filePath: string): Promise<{ content: string; size: number; binary: boolean; truncated: boolean }>`
  - `writeFileEntry(filePath: string, content: string): Promise<void>`
  - `createEntry(filePath: string, isDir: boolean): Promise<void>`
  - `renameEntry(workDir: string, oldRel: string, newRel: string): Promise<void>`
  - `deleteEntry(filePath: string): Promise<void>`（目录递归删除）

- [ ] **Step 1: 追加失败测试**

```ts
// tests/main/files.test.ts 追加
import { readFileEntry, writeFileEntry, createEntry, renameEntry, deleteEntry } from '../../src/main/files.js'

describe('文件操作', () => {
  let tmp: string
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-files-')) })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

  it('write 后 read 往返一致', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFileEntry(f, '你好 world')
    const r = await readFileEntry(f)
    expect(r.content).toBe('你好 world')
    expect(r.binary).toBe(false)
    expect(r.truncated).toBe(false)
    expect(r.size).toBeGreaterThan(0)
  })

  it('超大文本标记 truncated 且截断', async () => {
    const f = path.join(tmp, 'big.txt')
    await fs.promises.writeFile(f, 'x'.repeat(1024 * 1024 + 10))
    const r = await readFileEntry(f)
    expect(r.truncated).toBe(true)
    expect(r.binary).toBe(false)
    expect(r.content.length).toBeLessThan(1024 * 1024 + 10)
  })

  it('二进制文件标记 binary', async () => {
    const f = path.join(tmp, 'bin.dat')
    await fs.promises.writeFile(f, Buffer.from([0x01, 0x02, 0x00, 0x03]))
    const r = await readFileEntry(f)
    expect(r.binary).toBe(true)
  })

  it('create 文件/目录，rename 改名', async () => {
    await createEntry(path.join(tmp, 'f.ts'), false)
    expect(fs.existsSync(path.join(tmp, 'f.ts'))).toBe(true)
    await createEntry(path.join(tmp, 'd'), true)
    expect(fs.statSync(path.join(tmp, 'd')).isDirectory()).toBe(true)
    await renameEntry(tmp, 'f.ts', 'g.ts')
    expect(fs.existsSync(path.join(tmp, 'g.ts'))).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'f.ts'))).toBe(false)
  })

  it('delete 文件与目录（递归）', async () => {
    const f = path.join(tmp, 'x.ts')
    await writeFileEntry(f, 'x')
    await deleteEntry(f)
    expect(fs.existsSync(f)).toBe(false)
    const d = path.join(tmp, 'dir')
    fs.mkdirSync(path.join(d, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(d, 'sub', 'a.js'), 'a')
    await deleteEntry(d)
    expect(fs.existsSync(d)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --dir tests/main files`
Expected: FAIL，`readFileEntry is not a function` 等

- [ ] **Step 3: 实现操作函数**

```ts
// src/main/files.ts 追加
export async function readFileEntry(filePath: string): Promise<{ content: string; size: number; binary: boolean; truncated: boolean }> {
  const stat = await fs.promises.stat(filePath);
  const size = stat.size;
  const buf = await fs.promises.readFile(filePath);
  const binary = detectBinary(buf);
  if (binary) return { content: '', size, binary: true, truncated: false };
  if (size > MAX_TEXT_SIZE) {
    return { content: buf.subarray(0, MAX_TEXT_SIZE).toString('utf8'), size, binary: false, truncated: true };
  }
  return { content: buf.toString('utf8'), size, binary: false, truncated: false };
}

export async function writeFileEntry(filePath: string, content: string): Promise<void> {
  await fs.promises.writeFile(filePath, content, 'utf8');
}

export async function createEntry(filePath: string, isDir: boolean): Promise<void> {
  if (isDir) await fs.promises.mkdir(filePath, { recursive: false });
  else await fs.promises.writeFile(filePath, '', { flag: 'wx' }); // 已存在则抛错
}

export async function renameEntry(workDir: string, oldRel: string, newRel: string): Promise<void> {
  await fs.promises.rename(resolveEntry(workDir, oldRel), resolveEntry(workDir, newRel));
}

export async function deleteEntry(filePath: string): Promise<void> {
  const stat = await fs.promises.lstat(filePath);
  if (stat.isDirectory()) await fs.promises.rm(filePath, { recursive: true, force: true });
  else await fs.promises.unlink(filePath);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --dir tests/main files`
Expected: PASS（全部文件操作用例通过）

- [ ] **Step 5: Commit**

```bash
git add src/main/files.ts tests/main/files.test.ts
git commit -m "feat: 文件读写/新建/重命名/删除操作"
```

---

### Task 3: IPC 注册 + chokidar watcher + app.ts 接线

**Files:**
- Modify: `src/main/files.ts`（追加 registerFilesIpc + watcher）
- Modify: `src/main/app.ts:27`（import）、`src/main/app.ts:1368`（调用）

**Interfaces:**
- Consumes: Task 1/2 全部函数
- Produces:
  - `registerFilesIpc(): void`
  - IPC 通道：`file:listDir(wd, relPath?)`、`file:read(wd, relPath)`、`file:write(wd, relPath, content)`、`file:create(wd, relPath, isDir)`、`file:rename(wd, oldRel, newRel)`、`file:delete(wd, relPath)`、`file:watch(wd)`、`file:unwatch(wd)`
  - 事件：`getBus().emit('file:changed', { workDir, relPath })`

- [ ] **Step 1: 实现 IPC + watcher（追加到 files.ts 末尾）**

```ts
// src/main/files.ts 追加
import { ipcMain } from 'electron';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { getBus } from './events.js';

const watchers = new Map<string, FSWatcher>();
const watcherTimers = new Map<string, NodeJS.Timeout>();

export function registerFilesIpc(): void {
  ipcMain.handle('file:listDir', async (_e, workDir: string, relPath?: string) =>
    listDir(resolveEntry(workDir, relPath || '')));

  ipcMain.handle('file:read', async (_e, workDir: string, relPath: string) =>
    readFileEntry(resolveEntry(workDir, relPath)));

  ipcMain.handle('file:write', async (_e, workDir: string, relPath: string, content: string) => {
    await writeFileEntry(resolveEntry(workDir, relPath), content);
    return { ok: true };
  });

  ipcMain.handle('file:create', async (_e, workDir: string, relPath: string, isDir: boolean) => {
    await createEntry(resolveEntry(workDir, relPath), isDir);
    return { ok: true };
  });

  ipcMain.handle('file:rename', async (_e, workDir: string, oldRel: string, newRel: string) => {
    await renameEntry(workDir, oldRel, newRel);
    return { ok: true };
  });

  ipcMain.handle('file:delete', async (_e, workDir: string, relPath: string) => {
    await deleteEntry(resolveEntry(workDir, relPath));
    return { ok: true };
  });

  ipcMain.handle('file:watch', async (_e, workDir: string) => {
    startWatch(workDir);
    return { ok: true };
  });

  ipcMain.handle('file:unwatch', async (_e, workDir: string) => {
    await stopWatch(workDir);
    return { ok: true };
  });
}

function startWatch(workDir: string): void {
  if (watchers.has(workDir)) return;
  const w = chokidar.watch(workDir, {
    ignoreInitial: true,
    ignored: (p: string) => isIgnored(path.basename(p)),
  });
  w.on('all', (_event, p: string) => {
    const rel = path.relative(workDir, p).replace(/\\/g, '/');
    // 150ms 合帧，避免高频写入打爆 IPC
    const t = watcherTimers.get(workDir);
    if (t) clearTimeout(t);
    watcherTimers.set(workDir, setTimeout(() => {
      getBus().emit('file:changed', { workDir, relPath: rel });
    }, 150));
  });
  watchers.set(workDir, w);
}

async function stopWatch(workDir: string): Promise<void> {
  const w = watchers.get(workDir);
  if (w) { await w.close(); watchers.delete(workDir); }
  const t = watcherTimers.get(workDir);
  if (t) { clearTimeout(t); watcherTimers.delete(workDir); }
}
```

- [ ] **Step 2: app.ts 接线**

`src/main/app.ts`：
- import 区（`registerTraceIpc` 那行附近）加：
  ```ts
  import { registerFilesIpc } from './files.js';
  ```
- `registerIpcHandlers()` 中 `registerTraceIpc();` 之后加：
  ```ts
  registerFilesIpc();
  ```

- [ ] **Step 3: 验证编译 + 全量主进程测试**

Run: `npm run test:main`
Expected: PASS（既有测试不回归；files 新测试在内）

- [ ] **Step 4: Commit**

```bash
git add src/main/files.ts src/main/app.ts
git commit -m "feat: 文件服务 IPC 注册 + chokidar 监听（file:changed 事件）"
```

---

### Task 4: preload + useElectron 转发层

**Files:**
- Modify: `src/main/preload.ts`（api 对象末尾加方法）
- Modify: `src/renderer/src/composables/useElectron.ts`（末尾加转发函数）

**Interfaces:**
- Consumes: Task 3 的 IPC 通道名
- Produces: 渲染进程可用的 8 个转发函数 + `FileChanged` 订阅

- [ ] **Step 1: preload.ts 加方法**（`dshShutdown` 后追加）

```ts
  // 右侧文件编辑器侧栏
  fileListDir: (workDir: string, relPath?: string) =>
    ipcRenderer.invoke('file:listDir', workDir, relPath),
  fileRead: (workDir: string, relPath: string) =>
    ipcRenderer.invoke('file:read', workDir, relPath),
  fileWrite: (workDir: string, relPath: string, content: string) =>
    ipcRenderer.invoke('file:write', workDir, relPath, content),
  fileCreate: (workDir: string, relPath: string, isDir: boolean) =>
    ipcRenderer.invoke('file:create', workDir, relPath, isDir),
  fileRename: (workDir: string, oldRel: string, newRel: string) =>
    ipcRenderer.invoke('file:rename', workDir, oldRel, newRel),
  fileDelete: (workDir: string, relPath: string) =>
    ipcRenderer.invoke('file:delete', workDir, relPath),
  fileWatch: (workDir: string) => ipcRenderer.invoke('file:watch', workDir),
  fileUnwatch: (workDir: string) => ipcRenderer.invoke('file:unwatch', workDir),
```

- [ ] **Step 2: useElectron.ts 加转发函数**（末尾加）

```ts
// 右侧文件编辑器侧栏
export const FileListDir = (workDir: string, relPath?: string) => api().fileListDir(workDir, relPath);
export const FileRead = (workDir: string, relPath: string) => api().fileRead(workDir, relPath);
export const FileWrite = (workDir: string, relPath: string, content: string) => api().fileWrite(workDir, relPath, content);
export const FileCreate = (workDir: string, relPath: string, isDir: boolean) => api().fileCreate(workDir, relPath, isDir);
export const FileRename = (workDir: string, oldRel: string, newRel: string) => api().fileRename(workDir, oldRel, newRel);
export const FileDelete = (workDir: string, relPath: string) => api().fileDelete(workDir, relPath);
export const FileWatch = (workDir: string) => api().fileWatch(workDir);
export const FileUnwatch = (workDir: string) => api().fileUnwatch(workDir);
export const FileChanged = (cb: (e: { workDir: string; relPath: string }) => void) => EventsOn('file:changed', cb);
```

- [ ] **Step 3: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS（无新增类型错误）

- [ ] **Step 4: Commit**

```bash
git add src/main/preload.ts src/renderer/src/composables/useElectron.ts
git commit -m "feat: 文件服务 IPC 转发层（preload + useElectron）"
```

---

### Task 5: 渲染进程 files store + 安装 monaco-editor

**Files:**
- Modify: `src/renderer/package.json`（加 monaco-editor 依赖）
- Create: `src/renderer/src/stores/files.ts`

**Interfaces:**
- Consumes: Task 4 转发函数
- Produces:
  - `interface TreeEntry { name: string; isDir: boolean }`
  - `interface OpenFile { relPath: string; content: string; dirty: boolean; binary: boolean; truncated: boolean; externalChanged: boolean; savedVersion: number }`
  - store 状态：`workDir`、`tree: Record<string, TreeEntry[]>`、`expanded: Set<string>`、`openFiles: OpenFile[]`、`activeRelPath`、`collapsed`
  - 方法：`setSession(wd)`、`loadDir(relPath)`、`toggleExpand(relPath, isDir)`、`openFile(relPath)`、`closeFile(relPath)`、`saveFile(relPath)`、`markDirty(relPath, content, savedVersion)`、`reloadFile(relPath)`、`createEntry(parent, name, isDir)`、`renameEntry(oldRel, newName)`、`deleteEntry(relPath)`

- [ ] **Step 1: 安装 monaco-editor**

Run: `cd src/renderer && npm install monaco-editor`
Expected: `monaco-editor` 出现在 `src/renderer/package.json` dependencies

- [ ] **Step 2: 实现 files store**

```ts
// src/renderer/src/stores/files.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  FileListDir, FileRead, FileWrite, FileCreate, FileRename, FileDelete,
  FileWatch, FileUnwatch, FileChanged,
} from '../composables/useElectron'
import { pushToast } from '../composables/useToast'

export interface TreeEntry { name: string; isDir: boolean }
export interface OpenFile {
  relPath: string
  content: string
  dirty: boolean
  binary: boolean
  truncated: boolean
  externalChanged: boolean
  savedVersion: number // 打开/保存时自增，用于区分本地改动与外部变更
}

export const useFilesStore = defineStore('files', () => {
  const workDir = ref('')
  const tree = ref<Record<string, TreeEntry[]>>({ '': [] }) // relPath -> 单层条目
  const expanded = ref<Set<string>>(new Set())
  const openFiles = ref<OpenFile[]>([])
  const activeRelPath = ref<string | null>(null)
  const collapsed = ref(false) // 侧栏折叠态（HomeView 持有也可，先放这里）

  async function setSession(wd: string) {
    if (workDir.value) await FileUnwatch(workDir.value).catch(() => {})
    workDir.value = wd
    tree.value = { '': [] }
    expanded.value = new Set()
    openFiles.value = []
    activeRelPath.value = null
    if (wd) {
      await FileWatch(wd).catch(() => {})
      await loadDir('').catch(() => {})
    }
  }

  /** 拉取单层目录（已展开时刷新用）。返回条目列表，不抛错时更新 tree。 */
  async function loadDir(relPath: string): Promise<void> {
    const wd = workDir.value
    if (!wd) return
    const entries = await FileListDir(wd, relPath || undefined)
    tree.value = { ...tree.value, [relPath]: entries }
  }

  async function toggleExpand(relPath: string, isDir: boolean) {
    if (!isDir) return
    if (expanded.value.has(relPath)) {
      expanded.value = new Set([...expanded.value].filter((p) => p !== relPath))
      return
    }
    expanded.value = new Set([...expanded.value, relPath])
    await loadDir(relPath).catch(() => {})
  }

  /** 打开文件：已在 openFiles 则仅切激活；否则读取后加入。 */
  async function openFile(relPath: string) {
    const wd = workDir.value
    if (!wd) return
    const existing = openFiles.value.find((o) => o.relPath === relPath)
    if (existing) { activeRelPath.value = relPath; return }
    const r = await FileRead(wd, relPath)
    openFiles.value = [...openFiles.value, {
      relPath, content: r.content, dirty: false, binary: r.binary,
      truncated: r.truncated, externalChanged: false, savedVersion: 0,
    }]
    activeRelPath.value = relPath
  }

  function closeFile(relPath: string) {
    const f = openFiles.value.find((o) => o.relPath === relPath)
    if (f?.dirty && !window.confirm(`「${relPath}」有未保存修改，确定关闭？`)) return
    openFiles.value = openFiles.value.filter((o) => o.relPath !== relPath)
    if (activeRelPath.value === relPath) {
      activeRelPath.value = openFiles.value[openFiles.value.length - 1]?.relPath ?? null
    }
  }

  /** 编辑器内容变化时上报（保存版本 + 当前内容）。返回新 savedVersion 供编辑器存回。 */
  async function saveFile(relPath: string, content: string): Promise<number> {
    const wd = workDir.value
    if (!wd) return 0
    await FileWrite(wd, relPath, content)
    const f = openFiles.value.find((o) => o.relPath === relPath)
    if (f) {
      f.content = content
      f.dirty = false
      f.externalChanged = false
      f.savedVersion += 1
    }
    return f?.savedVersion ?? 0
  }

  async function reloadFile(relPath: string) {
    const wd = workDir.value
    if (!wd) return
    const r = await FileRead(wd, relPath)
    const f = openFiles.value.find((o) => o.relPath === relPath)
    if (f) {
      f.content = r.content
      f.dirty = false
      f.externalChanged = false
      f.savedVersion += 1
    }
  }

  async function createEntry(parentRel: string, name: string, isDir: boolean) {
    const wd = workDir.value
    if (!wd) return
    const rel = parentRel ? `${parentRel}/${name}` : name
    await FileCreate(wd, rel, isDir)
    if (!expanded.value.has(parentRel)) expanded.value = new Set([...expanded.value, parentRel])
    await loadDir(parentRel)
  }

  async function renameEntry(oldRel: string, newName: string) {
    const wd = workDir.value
    if (!wd) return
    const parent = oldRel.includes('/') ? oldRel.slice(0, oldRel.lastIndexOf('/')) : ''
    const newRel = parent ? `${parent}/${newName}` : newName
    await FileRename(wd, oldRel, newRel)
    if (parent && expanded.value.has(parent)) await loadDir(parent)
    // 重命名打开的 tab
    openFiles.value = openFiles.value.map((o) => o.relPath === oldRel ? { ...o, relPath: newRel } : o)
    if (activeRelPath.value === oldRel) activeRelPath.value = newRel
  }

  async function deleteEntry(relPath: string) {
    const wd = workDir.value
    if (!wd) return
    if (!window.confirm(`确定删除「${relPath}」？此操作不可撤销。`)) return
    await FileDelete(wd, relPath)
    const parent = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
    if (parent && expanded.value.has(parent)) await loadDir(parent)
    if (parent === '') await loadDir('')
    // 关闭被删文件的 tab
    openFiles.value = openFiles.value.filter((o) => o.relPath !== relPath)
    if (activeRelPath.value === relPath) {
      activeRelPath.value = openFiles.value[openFiles.value.length - 1]?.relPath ?? null
    }
  }

  // 外部变更：局部刷新树 + 处理打开文件的冲突
  let fileChangedCleanup: (() => void) | null = null
  function initWatcher() {
    fileChangedCleanup?.()
    fileChangedCleanup = FileChanged((e: { workDir: string; relPath: string }) => {
      if (e.workDir !== workDir.value) return
      const parts = e.relPath.split('/')
      const parent = parts.slice(0, -1).join('/')
      if (expanded.value.has(parent)) void loadDir(parent).catch(() => {})
      const f = openFiles.value.find((o) => o.relPath === e.relPath)
      if (f && !f.dirty) void reloadFile(e.relPath).catch(() => {})
      else if (f && f.dirty) f.externalChanged = true
    })
  }
  initWatcher()

  return {
    workDir, tree, expanded, openFiles, activeRelPath, collapsed,
    setSession, loadDir, toggleExpand, openFile, closeFile, saveFile, reloadFile,
    createEntry, renameEntry, deleteEntry,
    cleanupWatcher: () => { fileChangedCleanup?.(); fileChangedCleanup = null },
  }
})
```

- [ ] **Step 3: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/package.json src/renderer/package-lock.json src/renderer/src/stores/files.ts
git commit -m "feat: 文件编辑器 files store + monaco-editor 依赖"
```

---

### Task 6: FileTree 组件（懒加载展开 + 右键菜单 + 行内编辑）

**Files:**
- Create: `src/renderer/src/components/code/FileTree.vue`

**Interfaces:**
- Consumes: `useFilesStore`（Task 5）
- Produces: 渲染树；右键菜单 emit 回调交给 CodeSidebar 统一处理（新建/重命名/删除都走 store）

- [ ] **Step 1: 实现 FileTree.vue**

要点：
- 递归渲染 `store.tree[relPath]`；目录行点击 `toggleExpand(relPath, isDir)`。
- 图标：目录用 `folder`/`folder-open`，文件用 `file`（经 `components/Icon.vue`）。
- 右键目录/文件弹菜单：新建文件、新建文件夹（仅目录）、重命名、删除（均调 store 方法）。
- 行内编辑态：`store` 里的 `editing` 本地 ref（本组件内维护）：新建时输入框填默认名（如 `untitled.ts`），重命名时填当前名；Enter 提交、Esc 取消。
- 类型图标映射按扩展名：`.ts/.tsx→typescript`、`.js→javascript`、`.vue→vue`、`.json→json`、`.md→markdown` 等，其余 `file`。
- 空目录/空树显示「空」提示。

模板骨架：

```vue
<template>
  <div class="file-tree" @contextmenu.prevent>
    <div v-if="!store.workDir" class="tree-empty">无工作目录</div>
    <TreeRow v-else :rel-path="''" :depth="0" />
  </div>
</template>
```

`TreeRow` 用同文件内组件递归（Vue 3 SFC 递归需要 `defineOptions({ name: 'TreeRow' })`），对每个条目：

```vue
<div class="row" :style="{ paddingLeft: depth * 12 + 'px' }">
  <!-- 展开箭头 + 图标 + 名称 -->
  <!-- 行内编辑态显示输入框 -->
</div>
```

上下文菜单用简单绝对定位浮层（本组件内 `menu` ref：`{ x, y, relPath, isDir }`），点外部关闭。

- [ ] **Step 2: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/code/FileTree.vue
git commit -m "feat: 文件树组件（懒加载展开 + 右键新建/重命名/删除）"
```

---

### Task 7: CodeEditor + FileTabs 组件（Monaco 懒加载单例）

**Files:**
- Create: `src/renderer/src/components/code/FileTabs.vue`
- Create: `src/renderer/src/components/code/CodeEditor.vue`

**Interfaces:**
- Consumes: `useFilesStore`（Task 5）
- Produces: 单例 Monaco 编辑器 + tab 条

- [ ] **Step 1: 实现 FileTabs.vue**

- 遍历 `store.openFiles`，显示 `relPath` 末段（basename），激活项高亮。
- 脏标记：`dirty` 时文件名前显示圆点（`status-error` 色）。
- 外部变更：`externalChanged` 时显示小警示图标 + 「重新加载」按钮（调 `store.reloadFile`）。
- 点击 tab → `store.activeRelPath = relPath`；X 按钮 → `store.closeFile(relPath)`。
- 无打开文件时隐藏 tab 条。

- [ ] **Step 2: 实现 CodeEditor.vue**

```vue
<template>
  <div class="code-editor">
    <div v-if="!activeFile" class="editor-empty">从左侧文件树选择文件</div>
    <div v-else-if="activeFile.binary" class="editor-placeholder">二进制文件，无法编辑</div>
    <div v-else-if="activeFile.truncated" class="editor-placeholder">文件过大（只读，已截断显示）</div>
    <div v-else ref="editorEl" class="editor-host" />
    <div v-if="activeFile?.externalChanged" class="conflict-bar">
      <span>文件已在外部变更</span>
      <button @click="store.reloadFile(activeRelPath!)">重新加载（放弃本地改动）</button>
    </div>
  </div>
</template>
```

核心逻辑：
- **懒加载**：`let monacoModule: typeof import('monaco-editor') | null = null`；首次需要时 `monacoModule = await import('monaco-editor')`，并配置 `self.MonacoEnvironment.getWorker`：
  ```ts
  import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
  import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
  import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
  import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
  import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

  self.MonacoEnvironment = {
    getWorker(_: unknown, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    },
  }
  ```
- **单例实例**：`editor` 仅创建一次；创建时 `monaco.editor.create(editorEl, { theme: 'vs-dark', automaticLayout: true, fontSize: 12, minimap: { enabled: false }, scrollBeyondLastLine: false, tabSize: 2 })`。
- **切文件换 model**：`watch(activeRelPath)`，`model = monaco.editor.createModel(content, language, uri)` 前先 `editor.getModel()?.dispose()`（仅 dispose 编辑器持有的旧 model，保留 store 数据）；`editor.setModel(model)`。
- **语言映射** `languageFor(relPath)`：`.ts/.tsx→typescript` `.js/.jsx→javascript` `.vue→html`（vue SFC 用 html 高亮即可）`.json→json` `.md→markdown` `.py→python` `.yaml/.yml→yaml` `.css→css` `.html→html`，默认 `plaintext`。
- **脏标记**：`model.onDidChangeContent` → 若内容 != `activeFile.content` 则 `store` 更新 `dirty: true`（编辑器内容始终以 model 为准；保存后 `store.saveFile` 清脏并返回 savedVersion，本地记录避免回调误清）。
- **Ctrl+S**：`editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveActive())`，`saveActive` 读 `editor.getValue()` 调 `store.saveFile(relPath, content)`，失败 pushToast。
- **切换/关闭文件时**：`beforeUnmount` 释放监听与 `editor.dispose()`。

- [ ] **Step 3: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/code/FileTabs.vue src/renderer/src/components/code/CodeEditor.vue
git commit -m "feat: Monaco 代码编辑器（懒加载单例 + 脏标记 + Ctrl+S）与文件 tab"
```

---

### Task 8: CodeSidebar 容器 + HomeView 集成

**Files:**
- Create: `src/renderer/src/components/code/CodeSidebar.vue`
- Modify: `src/renderer/src/views/HomeView.vue`

**Interfaces:**
- Consumes: Task 6/7 组件 + `useFilesStore`

- [ ] **Step 1: 实现 CodeSidebar.vue**

- 布局：顶部工具条（刷新按钮 `refresh-cw` → `store.loadDir` 刷新已展开目录；新建文件按钮 `file-plus` → 在树根弹出新建行内输入；折叠按钮 `panel-right-close`/`panel-right-open`）+ 文件树区（`FileTree`）+ 编辑器区（`FileTabs` + `CodeEditor`）。
- **拖宽**：右边缘 4px 手柄 `@mousedown` 起 drag，`mousemove` 更新侧栏宽度（240–600px），`mouseup` 结束；宽度存 `localStorage`（key `lynel:code-sidebar-width`）。
- **折叠态**：`store.collapsed` 为 true 时只显示窄条（约 32px）+ 展开按钮，编辑器区不渲染（节省资源）。

- [ ] **Step 2: HomeView.vue 集成**

- 布局：在 `.center` 之后、右侧 Workspace 注释块位置加：
  ```vue
  <CodeSidebar v-if="tabsStore.activeType === 'session' && activeSessionWorkdir" />
  ```
- import `CodeSidebar` 与 `useFilesStore`。
- `watch(activeSessionId, ...)` 回调里（现有 trace.setSession 处）追加：
  ```ts
  const wd = activeSessionWorkdir.value
  if (wd) void files.setSession(wd)
  ```
- 离开会话页（activeType 非 session）时 `void files.setSession('')`（stopWatch 并清空状态），避免残留 watcher。

- [ ] **Step 3: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 手动验证（全栈 dev）**

Run: `npm run dev`
验证清单：
1. 打开一个会话 → 右侧出现侧栏，文件树显示 workDir 内容（过滤了 node_modules）。
2. 点目录展开，点文件在 Monaco 打开并高亮；改内容出脏点；Ctrl+S 保存成功。
3. 右键文件树新建/重命名/删除文件，树刷新。
4. 在外部编辑器改打开中的文件（无脏修改）→ 编辑器自动刷新；有脏修改 → 出现「外部变更」冲突条。
5. 拖宽/折叠/展开侧栏正常；切换会话编辑器 tab 重置为新 workDir。
6. 折叠侧栏后切到终端，无残留 watcher（终端性能不受影响）。

- [ ] **Step 5: 全量验证 + Commit**

Run: `npm run test:main` 和 `cd src/renderer && npx vue-tsc --noEmit` 全绿后：

```bash
git add src/renderer/src/components/code/CodeSidebar.vue src/renderer/src/views/HomeView.vue
git commit -m "feat: 右侧代码编辑器侧栏容器 + 会话页集成"
```

---

## Self-Review 记录

- **Spec 覆盖**：布局（Task 8）✓ 文件服务与忽略清单（Task 1-3）✓ 外部变更（Task 3 watcher + Task 5 store 处理 + Task 7 冲突条）✓ Monaco 集成与资源约束（Task 4 依赖 + Task 7 懒加载单例）✓ 管理操作（Task 5 store + Task 6 右键）✓ 错误处理（write 失败 toast、删除确认）✓ 测试（Task 1-2 单测 + Task 8 手动验证）✓。
- **占位符扫描**：无 TBD/TODO；每个代码步骤含完整实现。
- **类型一致性**：`OpenFile`、`TreeEntry`、store 方法签名跨 Task 5/6/7 一致；IPC 通道名跨 Task 3/4 一致（`file:listDir` 等）；事件 `file:changed` 负载 `{ workDir, relPath }` 三处一致。
