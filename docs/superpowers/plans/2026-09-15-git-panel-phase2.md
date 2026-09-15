# Git 面板 Phase 2 实施计划（变更列表 + diff + 暂存/提交/推送）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 1 建好的底部全宽面板里加入「Git」标签，让用户在同一画面内看到工作区变更、逐文件查看 diff、暂存/取消暂存/丢弃、写 commit message 提交、以及 fetch/pull/push。

**Architecture:** 主进程新增 `src/main/git.ts` 封装 `simple-git`（包装系统 git CLI），提供状态读取、变更操作、远程操作、按 revision 取文件内容四类能力，并监听 `.git` 目录变化推送 `git:changed` 事件。渲染进程新增 `stores/git.ts` 持有状态，`GitPanel.vue` 渲染变更列表与提交表单；diff 不在面板里渲染，而是交给编辑器区用 Monaco `createDiffEditor` 全宽展示（VSCode 的 `vscode.diff` 同思路）。

**Tech Stack:** Electron 主进程（ESM + `module: NodeNext`）、`simple-git`、`chokidar`（已在依赖中）、Vue 3 `<script setup lang="ts">`、Pinia（setup style）、`monaco-editor` 0.56（DiffEditor 内置于已装版本）。

## Global Constraints

以下约束适用于每个任务，不再逐条重复：

- 所有 IPC 返回 `{ ok: true, ...data }` 或 `{ ok: false, error: string }`，**主进程不得抛未捕获异常**（会导致窗口白屏）。`git.ts` 的每个导出函数都要自己 catch 并转成结构化错误。
- `src/renderer/src/composables/useElectron.ts` 是**唯一**接触 `window.electronAPI` 的文件；组件禁止直接 `window.electronAPI.X(...)`。
- 样式一律用 `styles/theme.css` 的 CSS 变量，不硬编码颜色。图标用 `@lucide/vue`，经 `components/Icon.vue` 引用（**新增图标前必须先 grep `Icon.vue` 确认该键已注册**，未注册要按现有风格补注册）。
- `tests/main/` 下**模块顶层不得触碰 electron API**（无 vitest 配置文件，`electron` 在测试环境解析为不可用）。只在函数体内调用 `ipcMain.*`。
- ESM 项目：相对 import 必须带 `.js` 后缀。
- 代码注释、commit message 一律简体中文。commit 用 `<type>: <subject>` 格式。
- 每个任务结束时 `npm run test:main` 与 `cd src/renderer && npx vue-tsc --noEmit` 必须全绿。
- 按项目约定，本计划**不含 git 提交以外的分支操作**；每个任务一个 commit。

### 范围约定（Phase 2 不做的事）

- **不做**：分支切换（checkout）、stash、rebase、cherry-pick、冲突解决 UI、提交历史图。这些分别属于 Phase 3 或刻意留给终端。
- **不做**：多仓库支持。面板只服务当前会话的 `workDir`。
- Git 面板的布局是**单栏纵向**（分支状态条 / 变更列表 / 提交表单）。设计文档里画的「变更 30% | 历史图 70%」横向分栏属于 Phase 3，届时再改布局。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/main/git.ts`（新） | GitService：所有 git 操作的唯一入口，含 `.git` watcher 与 IPC 注册 |
| `src/main/app.ts`（改） | 调用 `registerGitIpc()` |
| `src/main/preload.ts`（改） | git IPC 转发 |
| `src/renderer/src/composables/useElectron.ts`（改） | git IPC 类型化导出 |
| `src/renderer/src/stores/git.ts`（新） | Git 状态与动作（Pinia setup style） |
| `src/renderer/src/stores/files.ts`（改） | 新增 `diffRequest` 与 `openDiff`/`closeDiff` |
| `src/renderer/src/components/code/GitPanel.vue`（新） | 分支条 + 变更列表 + 提交表单 |
| `src/renderer/src/components/code/BottomPanel.vue`（改） | 标签加上「Git」 |
| `src/renderer/src/monaco/setup.ts`（新） | 从 `CodeEditor.vue` 抽出的 Monaco 初始化与主题构建 |
| `src/renderer/src/components/code/CodeEditor.vue`（改） | 改为从 `monaco/setup.ts` 引入（纯重构） |
| `src/renderer/src/components/code/CodeDiffView.vue`（新） | Monaco DiffEditor 包装 |
| `src/renderer/src/components/code/CodeView.vue`（改） | 编辑器区在 CodeEditor / CodeDiffView 间切换 |

---

## Task 1: 引入 simple-git 并实现状态读取

**Files:**
- Modify: `package.json`（新增依赖）
- Create: `src/main/git.ts`
- Test: `tests/main/git.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface GitFileChange { path: string; status: 'M'|'A'|'D'|'R'|'C'|'U'|'?'; oldPath?: string }`
  - `interface GitStatusResult { isRepo: boolean; branch: string | null; tracking: string | null; ahead: number; behind: number; detached: boolean; staged: GitFileChange[]; unstaged: GitFileChange[]; untracked: GitFileChange[]; conflicted: GitFileChange[] }`
  - `getStatus(workDir: string): Promise<{ ok: true; data: GitStatusResult } | { ok: false; error: string }>`

**为什么这个任务要单独存在**：设计文档标注了一个未验证的风险 —— 主进程是 ESM（`type: module` + `module: NodeNext`），而 `simple-git` 是 CJS 包。若互操作有问题，本计划的所有后续任务都要改为自建 `execFile('git', ...)` 包装（约 30 行）。所以**先装依赖、先写一个最简的读写验证**，确认可行再往下做。

- [ ] **Step 1: 安装依赖**

Run: `npm install simple-git`

Expected: `package.json` 的 `dependencies` 出现 `simple-git`，`package-lock.json` 更新。

- [ ] **Step 2: 写失败的测试**

创建 `tests/main/git.test.ts`：

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** 建一个真实的临时 git 仓库；git 操作类测试不用 mock —— mock 掉的正是被测对象 */
function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-git-'));
  const run = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run(['init']);
  run(['config', 'user.name', 'lynel-test']);
  run(['config', 'user.email', 'test@lynel.local']);
  run(['commit', '--allow-empty', '-m', 'init']);
  return dir;
}

describe('git', () => {
  let repo: string;
  let plain: string;

  beforeAll(() => {
    repo = makeRepo();
    plain = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-nogit-'));
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('非 git 目录返回 isRepo=false 而不是抛错', async () => {
    const { getStatus } = await import('../../src/main/git.js');
    const res = await getStatus(plain);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.isRepo).toBe(false);
      expect(res.data.staged).toEqual([]);
    }
  });

  it('干净仓库：报告分支且无变更', async () => {
    const { getStatus } = await import('../../src/main/git.js');
    const res = await getStatus(repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.isRepo).toBe(true);
    expect(res.data.branch).toBeTruthy();
    expect(res.data.staged).toEqual([]);
    expect(res.data.unstaged).toEqual([]);
    expect(res.data.untracked).toEqual([]);
  });

  it('区分未跟踪 / 未暂存 / 已暂存', async () => {
    const { getStatus } = await import('../../src/main/git.js');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'u\n');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'a\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'add tracked'], { cwd: repo });
    // 提交后再改，制造未暂存
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'b\n');
    // 再制造一个已暂存的
    fs.writeFileSync(path.join(repo, 'staged.txt'), 's\n');
    execFileSync('git', ['add', 'staged.txt'], { cwd: repo });

    const res = await getStatus(repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.untracked.map((f) => f.path)).toContain('untracked.txt');
    expect(res.data.unstaged.map((f) => f.path)).toContain('tracked.txt');
    expect(res.data.unstaged.find((f) => f.path === 'tracked.txt')?.status).toBe('M');
    expect(res.data.staged.map((f) => f.path)).toContain('staged.txt');
    expect(res.data.staged.find((f) => f.path === 'staged.txt')?.status).toBe('A');
  });
});
```

- [ ] **Step 3: 运行测试确认它失败**

Run: `npx vitest run --dir tests/main git`
Expected: FAIL — `Failed to resolve import "../../src/main/git.js"`

- [ ] **Step 4: 实现 git.ts 的状态读取**

创建 `src/main/git.ts`：

```ts
// Git 服务：所有 git 操作的唯一入口。
// 用 simple-git 包装系统 git CLI（与 VSCode 的做法一致：不重新实现 git，只做
// 命令代理 + 状态管理）。
import simpleGit, { type SimpleGit } from 'simple-git';

export type GitFileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

export interface GitFileChange {
  /** 相对 workDir 的路径，统一用正斜杠 */
  path: string;
  status: GitFileStatus;
  /** 重命名时的原路径 */
  oldPath?: string;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: GitFileChange[];
  conflicted: GitFileChange[];
}

const EMPTY_STATUS: GitStatusResult = {
  isRepo: false,
  branch: null,
  tracking: null,
  ahead: 0,
  behind: 0,
  detached: false,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
};

/** 每个 workDir 复用一个 SimpleGit 实例 */
const clients = new Map<string, SimpleGit>();

function gitFor(workDir: string): SimpleGit {
  let g = clients.get(workDir);
  if (!g) {
    g = simpleGit({ baseDir: workDir });
    clients.set(workDir, g);
  }
  return g;
}

/** git 的状态字母里，'?' 表示未跟踪；其余大写单字母直接用，无法识别的按 M 处理 */
function normalizeStatus(raw: string): GitFileStatus {
  const c = raw.trim().toUpperCase();
  if (c === '' || c === '?') return '?';
  if (c === 'M' || c === 'A' || c === 'D' || c === 'R' || c === 'C' || c === 'U') return c;
  // T（类型变更）等罕见字母归入 M，避免前端出现未知状态
  return 'M';
}

/** 把 simple-git 的 files[] 按「暂存 / 未暂存 / 未跟踪 / 冲突」分组 */
function groupChanges(
  files: { path: string; index: string; working_dir: string }[],
  renamed: { from: string; to: string }[],
): Pick<GitStatusResult, 'staged' | 'unstaged' | 'untracked' | 'conflicted'> {
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  const untracked: GitFileChange[] = [];
  const conflicted: GitFileChange[] = [];

  const oldPathOf = new Map(renamed.map((r) => [r.to, r.from]));

  for (const f of files) {
    const idx = f.index;
    const wd = f.working_dir;
    const oldPath = oldPathOf.get(f.path);

    // 冲突：任一侧为 U，或双方同名同操作（AA / DD）
    if (idx === 'U' || wd === 'U' || (idx === 'A' && wd === 'A') || (idx === 'D' && wd === 'D')) {
      conflicted.push({ path: f.path, status: 'U', oldPath });
      continue;
    }
    if (wd === '?') {
      untracked.push({ path: f.path, status: '?', oldPath });
      continue;
    }
    if (idx && idx !== ' ' && idx !== '?') {
      staged.push({ path: f.path, status: normalizeStatus(idx), oldPath });
    }
    if (wd && wd !== ' ' && wd !== '?') {
      unstaged.push({ path: f.path, status: normalizeStatus(wd), oldPath });
    }
  }
  return { staged, unstaged, untracked, conflicted };
}

export async function getStatus(
  workDir: string,
): Promise<{ ok: true; data: GitStatusResult } | { ok: false; error: string }> {
  try {
    const status = await gitFor(workDir).status();
    const groups = groupChanges(status.files, status.renamed);
    return {
      ok: true,
      data: {
        isRepo: true,
        branch: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        detached: status.detached,
        ...groups,
      },
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    // 非 git 仓库时 simple-git 会抛错；这是正常的用户状态，不是错误
    if (/not a git repository/i.test(msg)) {
      return { ok: true, data: { ...EMPTY_STATUS } };
    }
    return { ok: false, error: msg };
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --dir tests/main git`
Expected: PASS（3 个用例）

- [ ] **Step 6: 全量回归**

Run: `npm run test:main && npx tsc --noEmit -p tsconfig.json`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add package.json package-lock.json src/main/git.ts tests/main/git.test.ts
git commit -m "feat: 引入 simple-git 并实现工作区状态读取"
```

---

## Task 2: 变更操作（暂存 / 取消暂存 / 丢弃）

**Files:**
- Modify: `src/main/git.ts`
- Test: `tests/main/git.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `gitFor()`、`getStatus()`
- Produces:
  - `stage(workDir: string, relPaths: string[]): Promise<GitOpResult>`
  - `unstage(workDir: string, relPaths: string[]): Promise<GitOpResult>`
  - `discard(workDir: string, relPaths: string[]): Promise<GitOpResult>`
  - `type GitOpResult = { ok: true } | { ok: false; error: string }`

- [ ] **Step 1: 写失败的测试**

在 `tests/main/git.test.ts` 中追加 describe 块（放在文件末尾）：

```ts
describe('git 变更操作', () => {
  let repo: string;
  const sh = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });

  beforeAll(() => {
    repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n');
    sh(['add', 'a.txt']);
    sh(['commit', '-m', 'add a']);
  });

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('stage 把未跟踪文件移入暂存区', async () => {
    const { stage, getStatus } = await import('../../src/main/git.js');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'n\n');
    expect((await stage(repo, ['new.txt'])).ok).toBe(true);
    const s = await getStatus(repo);
    expect(s.ok && s.data.staged.map((f) => f.path)).toContain('new.txt');
    expect(s.ok && s.data.untracked.map((f) => f.path)).not.toContain('new.txt');
  });

  it('unstage 把暂存文件移回工作区', async () => {
    const { unstage, getStatus } = await import('../../src/main/git.js');
    expect((await unstage(repo, ['new.txt'])).ok).toBe(true);
    const s = await getStatus(repo);
    expect(s.ok && s.data.staged.map((f) => f.path)).not.toContain('new.txt');
    expect(s.ok && s.data.untracked.map((f) => f.path)).toContain('new.txt');
  });

  it('discard 把已跟踪文件的改动还原到 HEAD', async () => {
    const { discard, getStatus } = await import('../../src/main/git.js');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'CHANGED\n');
    let s = await getStatus(repo);
    expect(s.ok && s.data.unstaged.map((f) => f.path)).toContain('a.txt');

    expect((await discard(repo, ['a.txt'])).ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('v1\n');
    s = await getStatus(repo);
    expect(s.ok && s.data.unstaged.map((f) => f.path)).not.toContain('a.txt');
  });

  it('discard 对未跟踪文件：删除它', async () => {
    const { discard } = await import('../../src/main/git.js');
    const p = path.join(repo, 'to-delete.txt');
    fs.writeFileSync(p, 'x\n');
    expect((await discard(repo, ['to-delete.txt'])).ok).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('对非仓库返回 ok=false 而不是抛错', async () => {
    const { stage } = await import('../../src/main/git.js');
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-nogit2-'));
    const res = await stage(plain, ['whatever.txt']);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(typeof res.error).toBe('string');
    fs.rmSync(plain, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --dir tests/main git`
Expected: FAIL —— `stage is not a function`（或 import 报错）

- [ ] **Step 3: 实现三个操作**

在 `src/main/git.ts` 末尾追加：

```ts
export type GitOpResult = { ok: true } | { ok: false; error: string };

/** 统一的错误包装：主进程不得让 git 的异常冒泡（会导致窗口白屏） */
async function runOp(fn: () => Promise<unknown>): Promise<GitOpResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** 暂存：对未跟踪文件等价于 add；对已修改文件等价于 add */
export function stage(workDir: string, relPaths: string[]): Promise<GitOpResult> {
  if (relPaths.length === 0) return Promise.resolve({ ok: true });
  return runOp(() => gitFor(workDir).add(relPaths));
}

/** 取消暂存：reset 到 HEAD（新仓库尚无 HEAD 时退回 `rm --cached`） */
export function unstage(workDir: string, relPaths: string[]): Promise<GitOpResult> {
  if (relPaths.length === 0) return Promise.resolve({ ok: true });
  return runOp(async () => {
    const g = gitFor(workDir);
    try {
      await g.reset(['HEAD', '--', ...relPaths]);
    } catch {
      // 初始提交之前没有 HEAD，用 rm --cached 达到同样效果
      await g.raw(['rm', '--cached', '-r', '--', ...relPaths]);
    }
  });
}

/** 丢弃工作区改动：已跟踪文件 checkout 还原；未跟踪文件直接删除。
 *  调用方（渲染进程）必须先做二次确认 —— 这是不可逆操作。 */
export async function discard(workDir: string, relPaths: string[]): Promise<GitOpResult> {
  if (relPaths.length === 0) return { ok: true };

  const status = await getStatus(workDir);
  if (!status.ok) return { ok: false, error: status.error };

  const tracked = new Set([
    ...status.data.unstaged.map((f) => f.path),
    ...status.data.staged.map((f) => f.path),
    ...status.data.conflicted.map((f) => f.path),
  ]);

  return runOp(async () => {
    const g = gitFor(workDir);
    const trackedPaths = relPaths.filter((p) => tracked.has(p));
    const others = relPaths.filter((p) => !tracked.has(p));

    if (trackedPaths.length > 0) {
      // 先取消暂存再 checkout HEAD，保证「暂存 + 已修改」的文件也能整回到 HEAD
      await unstage(workDir, trackedPaths);
      await g.checkout(['--', ...trackedPaths]);
    }
    if (others.length > 0) {
      const fs = await import('node:fs');
      const nodePath = await import('node:path');
      for (const rel of others) {
        const abs = nodePath.join(workDir, rel);
        if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
      }
    }
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --dir tests/main git`
Expected: PASS（8 个用例）

- [ ] **Step 5: 全量回归并提交**

Run: `npm run test:main && npx tsc --noEmit -p tsconfig.json`

```bash
git add src/main/git.ts tests/main/git.test.ts
git commit -m "feat: git 变更操作（暂存/取消暂存/丢弃）"
```

---

## Task 3: 提交、远程操作与按 revision 取文件

**Files:**
- Modify: `src/main/git.ts`
- Test: `tests/main/git.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1/2 的 `gitFor()`、`runOp()`、`getStatus()`
- Produces:
  - `commit(workDir: string, message: string): Promise<GitOpResult>`
  - `remoteOp(workDir: string, op: 'fetch'|'pull'|'push'): Promise<{ ok: true; summary: string } | { ok: false; error: string }>`
  - `fileAtRev(workDir: string, rev: string, relPath: string): Promise<{ ok: true; content: string; binary: boolean; truncated: boolean } | { ok: false; error: string }>`
  - 常量 `MAX_TEXT_SIZE = 1024 * 1024`

**关于 `fileAtRev` 的 `rev` 取值**（diff 两侧内容都靠它）：

| 用途 | rev |
|---|---|
| HEAD 版本 | `'HEAD'` |
| 暂存区（index）版本 | `':0'` |
| 某个提交 | 提交 hash |

完整调用是 `git show <rev>:<path>`。

- [ ] **Step 1: 写失败的测试**

追加到 `tests/main/git.test.ts`：

```ts
describe('git 提交 / 取版本 / 远程', () => {
  let repo: string;
  const sh = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });

  beforeAll(() => {
    repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'one\n');
    sh(['add', 'f.txt']);
    sh(['commit', '-m', 'first']);
  });

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('commit 用给定 message 提交暂存区', async () => {
    const { commit, getStatus } = await import('../../src/main/git.js');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'two\n');
    sh(['add', 'f.txt']);
    const res = await commit(repo, 'second commit');
    expect(res.ok).toBe(true);
    const log = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repo, encoding: 'utf8' }).trim();
    expect(log).toBe('second commit');
    const s = await getStatus(repo);
    expect(s.ok && s.data.staged).toEqual([]);
  });

  it('commit 空 message 直接拒绝，不产生提交', async () => {
    const { commit } = await import('../../src/main/git.js');
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const res = await commit(repo, '   ');
    expect(res.ok).toBe(false);
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    expect(after).toBe(before);
  });

  it('fileAtRev 取 HEAD 历史版本，index 版本用 :0', async () => {
    const { fileAtRev } = await import('../../src/main/git.js');
    // 工作区改成 three，未暂存 → HEAD 仍是 two，index 也是 two
    fs.writeFileSync(path.join(repo, 'f.txt'), 'three\n');

    const head = await fileAtRev(repo, 'HEAD', 'f.txt');
    expect(head.ok && head.content).toBe('two\n');

    const index = await fileAtRev(repo, ':0', 'f.txt');
    expect(index.ok && index.content).toBe('two\n');

    // 暂存后 index 变成 three，HEAD 不变
    sh(['add', 'f.txt']);
    const index2 = await fileAtRev(repo, ':0', 'f.txt');
    expect(index2.ok && index2.content).toBe('three\n');
    const head2 = await fileAtRev(repo, 'HEAD', 'f.txt');
    expect(head2.ok && head2.content).toBe('two\n');
  });

  it('fileAtRev 对不存在的路径返回错误而非抛异常', async () => {
    const { fileAtRev } = await import('../../src/main/git.js');
    const res = await fileAtRev(repo, 'HEAD', 'nope.txt');
    expect(res.ok).toBe(false);
  });

  it('remoteOp 在没有远端时返回可读错误', async () => {
    const { remoteOp } = await import('../../src/main/git.js');
    const res = await remoteOp(repo, 'push');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --dir tests/main git`
Expected: FAIL —— `commit is not a function`

- [ ] **Step 3: 实现**

追加到 `src/main/git.ts`：

```ts
/** 与 files.ts 保持一致的单文件文本上限；超过则截断标记 */
export const MAX_TEXT_SIZE = 1024 * 1024;

export async function commit(workDir: string, message: string): Promise<GitOpResult> {
  const msg = message.trim();
  if (!msg) return { ok: false, error: '提交说明不能为空' };
  return runOp(() => gitFor(workDir).commit(msg));
}

/** fetch / pull / push。耗时可能较长，调用方负责禁用按钮防重复触发。 */
export async function remoteOp(
  workDir: string,
  op: 'fetch' | 'pull' | 'push',
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  try {
    const g = gitFor(workDir);
    if (op === 'fetch') {
      const r = await g.fetch();
      return { ok: true, summary: `fetch 完成（${r.remote ?? ''}）` };
    }
    if (op === 'pull') {
      const r = await g.pull();
      const changed = r.summary?.changes ?? 0;
      return { ok: true, summary: `pull 完成，更新 ${changed} 个文件` };
    }
    const r = await g.push();
    return { ok: true, summary: `push 完成（${r.pushed?.length ?? 0} 个分支）` };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** 取某 revision 下某个文件的内容（diff 两侧靠它）。
 *  binary / 超大文件的处理策略与 files.ts 的 readFileEntry 一致。
 *  这里**刻意不用** simple-git 的 raw()：它默认按 utf8 解码，二进制内容会被破坏，
 *  而这个函数的调用方（diff 视图）需要靠原始字节判断二进制。 */
export async function fileAtRev(
  workDir: string,
  rev: string,
  relPath: string,
): Promise<
  | { ok: true; content: string; binary: boolean; truncated: boolean }
  | { ok: false; error: string }
> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `${rev}:${relPath}`], {
      cwd: workDir,
      encoding: 'buffer',
      maxBuffer: MAX_TEXT_SIZE * 4,
    });
    const data = stdout as unknown as Buffer;

    if (data.subarray(0, 8192).includes(0)) {
      return { ok: true, content: '', binary: true, truncated: false };
    }
    if (data.length > MAX_TEXT_SIZE) {
      return {
        ok: true,
        content: data.subarray(0, MAX_TEXT_SIZE).toString('utf8'),
        binary: false,
        truncated: true,
      };
    }
    return { ok: true, content: data.toString('utf8'), binary: false, truncated: false };
  } catch (err: any) {
    // 文件在该 revision 不存在（新增文件取 HEAD 版本）是正常情况
    return { ok: false, error: err?.message || String(err) };
  }
}
```

同一步骤里，在 `src/main/git.ts` 顶部的 import 区补上：

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
```

（`execFileAsync` 内部用 `encoding: 'buffer'` 时返回的 `stdout` 是 `Buffer`，但 TS 的重载推导会当成 `string`，所以上面用了 `as unknown as Buffer` 断言。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --dir tests/main git`
Expected: PASS（13 个用例）

- [ ] **Step 5: 全量回归并提交**

Run: `npm run test:main && npx tsc --noEmit -p tsconfig.json`

```bash
git add src/main/git.ts tests/main/git.test.ts
git commit -m "feat: git 提交、远程操作与按 revision 取文件"
```

---

## Task 4: `.git` 变更监听 + IPC 注册 + 渲染层转发

**Files:**
- Modify: `src/main/git.ts`（追加 watcher 与 IPC）
- Modify: `src/main/app.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/src/composables/useElectron.ts`

**Interfaces:**
- Consumes: Task 1-3 的全部 git 函数；`getBus()`；`getLogger()`；`chokidar`（已在根依赖）
- Produces:
  - `watchGit(workDir: string): void` / `unwatchGit(workDir: string): Promise<void>`
  - `registerGitIpc(): void`（注册 `git:status` / `git:stage` / `git:unstage` / `git:discard` / `git:commit` / `git:remoteOp` / `git:fileAtRev` / `git:watch` / `git:unwatch`）
  - 事件 `git:changed`（载荷 `workDir: string`）
  - 渲染层：`GitStatus` / `GitStage` / `GitUnstage` / `GitDiscard` / `GitCommit` / `GitRemoteOp` / `GitFileAtRev` / `GitWatch` / `GitUnwatch` / `GitChanged`

**为什么 `.git` 单独监听**：`files.ts` 已有的 chokidar 监听把 `.git` 排除在忽略清单外（`IGNORED_DIRS` 含 `.git`），所以文件树的 watcher 看不到 git 内部状态变化（提交、checkout、切换分支）。Git 面板必须自己盯 `.git/HEAD`、`.git/index`、`.git/refs/**`。

- [ ] **Step 1: 实现 watcher 与 IPC**

在 `src/main/git.ts` 追加（顶部补 `import chokidar from 'chokidar'`、`import { ipcMain } from 'electron'`、`import { getBus } from './events.js'`、`import { getLogger } from './log.js'`）：

```ts
// —— .git 变更监听 ——
const watchers = new Map<string, ReturnType<typeof chokidar.watch>>();
const debounceTimers = new Map<string, NodeJS.Timeout>();

/** 监听 git 内部状态文件。不监 objects/ 与 logs/（写入极频繁且与 UI 无关） */
export function watchGit(workDir: string): void {
  if (watchers.has(workDir)) return;
  const gitDir = `${workDir}/.git`;
  const w = chokidar.watch(
    [`${gitDir}/HEAD`, `${gitDir}/index`, `${gitDir}/refs`],
    { ignoreInitial: true, depth: 4 },
  );
  w.on('all', () => {
    const t = debounceTimers.get(workDir);
    if (t) clearTimeout(t);
    // 500ms 合帧：一次 git 操作会连写多个文件
    debounceTimers.set(
      workDir,
      setTimeout(() => getBus().emit('git:changed', workDir), 500),
    );
  });
  w.on('error', (err) => getLogger().warn(`[git] watcher error ${workDir}: ${err}`));
  watchers.set(workDir, w);
}

export async function unwatchGit(workDir: string): Promise<void> {
  const w = watchers.get(workDir);
  if (w) {
    await w.close();
    watchers.delete(workDir);
  }
  const t = debounceTimers.get(workDir);
  if (t) {
    clearTimeout(t);
    debounceTimers.delete(workDir);
  }
}

// —— IPC ——
export function registerGitIpc(): void {
  ipcMain.handle('git:status', (_e, workDir: string) => getStatus(workDir));
  ipcMain.handle('git:stage', (_e, workDir: string, paths: string[]) => stage(workDir, paths));
  ipcMain.handle('git:unstage', (_e, workDir: string, paths: string[]) => unstage(workDir, paths));
  ipcMain.handle('git:discard', (_e, workDir: string, paths: string[]) => discard(workDir, paths));
  ipcMain.handle('git:commit', (_e, workDir: string, message: string) => commit(workDir, message));
  ipcMain.handle('git:remoteOp', (_e, workDir: string, op: 'fetch' | 'pull' | 'push') =>
    remoteOp(workDir, op),
  );
  ipcMain.handle('git:fileAtRev', (_e, workDir: string, rev: string, relPath: string) =>
    fileAtRev(workDir, rev, relPath),
  );
  ipcMain.handle('git:watch', (_e, workDir: string) => {
    watchGit(workDir);
    return { ok: true };
  });
  ipcMain.handle('git:unwatch', async (_e, workDir: string) => {
    await unwatchGit(workDir);
    return { ok: true };
  });
}
```

- [ ] **Step 2: 接进 app.ts**

在 `src/main/app.ts` 的 import 区（`registerShellIpc` 那组之后）追加：

```ts
import { registerGitIpc } from './git.js';
```

在 `registerIpcHandlers()` 里（`registerShellIpc();` 之后）追加：

```ts
    registerGitIpc();
```

- [ ] **Step 3: preload 转发**

在 `src/main/preload.ts` 的 `api` 对象内、`shellClose` 那组之后追加：

```ts
  gitStatus: (workDir: string) => ipcRenderer.invoke('git:status', workDir),
  gitStage: (workDir: string, paths: string[]) => ipcRenderer.invoke('git:stage', workDir, paths),
  gitUnstage: (workDir: string, paths: string[]) =>
    ipcRenderer.invoke('git:unstage', workDir, paths),
  gitDiscard: (workDir: string, paths: string[]) =>
    ipcRenderer.invoke('git:discard', workDir, paths),
  gitCommit: (workDir: string, message: string) => ipcRenderer.invoke('git:commit', workDir, message),
  gitRemoteOp: (workDir: string, op: string) => ipcRenderer.invoke('git:remoteOp', workDir, op),
  gitFileAtRev: (workDir: string, rev: string, relPath: string) =>
    ipcRenderer.invoke('git:fileAtRev', workDir, rev, relPath),
  gitWatch: (workDir: string) => ipcRenderer.invoke('git:watch', workDir),
  gitUnwatch: (workDir: string) => ipcRenderer.invoke('git:unwatch', workDir),
```

- [ ] **Step 4: useElectron.ts 类型化导出**

在 `src/renderer/src/composables/useElectron.ts` 的 shell 那组之后追加：

```ts
// Git 面板。类型直接复用主进程的定义（仅 type import，编译期擦除，
// 不会把主进程代码拉进渲染进程 bundle），避免两份定义漂移。
import type { GitFileChange, GitStatusResult } from '../../../main/git.js'
export type { GitFileChange, GitStatusResult }

type GitOk<T> = { ok: true } & T
type GitErr = { ok: false; error: string }

export const GitStatus = (workDir: string) =>
  api().gitStatus(workDir) as Promise<GitOk<{ data: GitStatusResult }> | GitErr>
export const GitStage = (workDir: string, paths: string[]) =>
  api().gitStage(workDir, paths) as Promise<GitOk<{}> | GitErr>
export const GitUnstage = (workDir: string, paths: string[]) =>
  api().gitUnstage(workDir, paths) as Promise<GitOk<{}> | GitErr>
export const GitDiscard = (workDir: string, paths: string[]) =>
  api().gitDiscard(workDir, paths) as Promise<GitOk<{}> | GitErr>
export const GitCommit = (workDir: string, message: string) =>
  api().gitCommit(workDir, message) as Promise<GitOk<{}> | GitErr>
export const GitRemoteOp = (workDir: string, op: 'fetch' | 'pull' | 'push') =>
  api().gitRemoteOp(workDir, op) as Promise<GitOk<{ summary: string }> | GitErr>
export const GitFileAtRev = (workDir: string, rev: string, relPath: string) =>
  api().gitFileAtRev(workDir, rev, relPath) as Promise<
    GitOk<{ content: string; binary: boolean; truncated: boolean }> | GitErr
  >
export const GitWatch = (workDir: string) => api().gitWatch(workDir) as Promise<GitOk<{}>>
export const GitUnwatch = (workDir: string) => api().gitUnwatch(workDir) as Promise<GitOk<{}>>
export const GitChanged = (cb: (workDir: string) => void) => EventsOn('git:changed', cb)
```

- [ ] **Step 5: 验证**

Run: `npm run test:main && npx tsc --noEmit -p tsconfig.json && cd src/renderer && npx vue-tsc --noEmit`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
git add src/main/git.ts src/main/app.ts src/main/preload.ts src/renderer/src/composables/useElectron.ts
git commit -m "feat: git IPC 注册、.git 变更监听与渲染层转发"
```

---

## Task 5: `stores/git.ts`

**Files:**
- Create: `src/renderer/src/stores/git.ts`

**Interfaces:**
- Consumes: Task 4 的 `GitStatus` / `GitStage` / `GitUnstage` / `GitDiscard` / `GitCommit` / `GitRemoteOp` / `GitWatch` / `GitUnwatch` / `GitChanged` / `GitStatusResult` / `GitFileChange`
- Produces: `useGitStore()`，暴露
  - 状态：`workDir`（string）、`status`（`GitStatusResult | null`）、`loading`（boolean）、`busyOp`（`string | null`）、`error`（string）
  - 动作：`setSession(workDir: string): Promise<void>`、`refresh(): Promise<void>`、`stage(paths)`、`unstage(paths)`、`discard(paths)`、`commit(message)`、`runRemoteOp(op)`
  - 计算：`totalChanges`（number）、`hasStaged`（boolean）

- [ ] **Step 1: 实现 store**

创建 `src/renderer/src/stores/git.ts`：

```ts
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  GitStatus,
  GitStage,
  GitUnstage,
  GitDiscard,
  GitCommit,
  GitRemoteOp,
  GitWatch,
  GitUnwatch,
  GitChanged,
  type GitStatusResult,
} from '../composables/useElectron'
import { pushToast } from '../composables/useToast'

export const useGitStore = defineStore('git', () => {
  const workDir = ref('')
  const status = ref<GitStatusResult | null>(null)
  const loading = ref(false)
  const error = ref('')
  /** 正在执行的远程/提交操作名，用于禁用按钮防重复触发 */
  const busyOp = ref<string | null>(null)

  const totalChanges = computed(() => {
    const s = status.value
    if (!s) return 0
    return s.staged.length + s.unstaged.length + s.untracked.length + s.conflicted.length
  })
  const hasStaged = computed(() => (status.value?.staged.length ?? 0) > 0)

  async function refresh(): Promise<void> {
    const wd = workDir.value
    if (!wd) {
      status.value = null
      return
    }
    loading.value = true
    try {
      const res = await GitStatus(wd)
      // 切换会话期间可能已经换了 workDir，丢弃过期结果
      if (workDir.value !== wd) return
      if (res.ok) {
        status.value = res.data
        error.value = ''
      } else {
        // 保持上一次的 status，把错误显示在面板里
        error.value = res.error
      }
    } catch (e: any) {
      error.value = e?.message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  /** 切换会话：换目录、重挂 watcher、刷新一次 */
  async function setSession(wd: string): Promise<void> {
    if (workDir.value === wd) return
    const prev = workDir.value
    workDir.value = wd
    status.value = null
    error.value = ''
    if (prev) await GitUnwatch(prev).catch(() => {})
    if (!wd) return
    await GitWatch(wd).catch(() => {})
    await refresh()
  }

  /** 统一包装「执行一次写操作 + 刷新 + 失败提示」 */
  async function withOp(name: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    if (busyOp.value) return
    busyOp.value = name
    try {
      const res = await fn()
      if (!res.ok) {
        pushToast({ level: 'error', source: 'git', message: res.error ?? `${name} 失败` })
        return
      }
      await refresh()
    } catch (e: any) {
      pushToast({ level: 'error', source: 'git', message: e?.message ?? String(e) })
    } finally {
      busyOp.value = null
    }
  }

  const stage = (paths: string[]) => withOp('暂存', () => GitStage(workDir.value, paths))
  const unstage = (paths: string[]) => withOp('取消暂存', () => GitUnstage(workDir.value, paths))
  const discard = (paths: string[]) => withOp('丢弃', () => GitDiscard(workDir.value, paths))

  const commit = (message: string) =>
    withOp('提交', async () => {
      const res = await GitCommit(workDir.value, message)
      if (!res.ok) return res
      pushToast({ level: 'info', source: 'git', message: '提交成功' })
      return res
    })

  const runRemoteOp = (op: 'fetch' | 'pull' | 'push') =>
    withOp(op, async () => {
      const res = await GitRemoteOp(workDir.value, op)
      if (!res.ok) return res
      pushToast({ level: 'info', source: 'git', message: res.summary })
      return res
    })

  // git 内部状态变化（提交、外部 checkout 等）→ 自动刷新
  GitChanged((wd: string) => {
    if (wd === workDir.value) void refresh()
  })

  return {
    workDir, status, loading, error, busyOp,
    totalChanges, hasStaged,
    setSession, refresh, stage, unstage, discard, commit, runRemoteOp,
  }
})
```

- [ ] **Step 2: 验证类型**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/stores/git.ts
git commit -m "feat: 新增 git store 管理变更状态与操作"
```

---

## Task 6: `GitPanel.vue` 与底部面板接入 Git 标签

**Files:**
- Create: `src/renderer/src/components/code/GitPanel.vue`
- Modify: `src/renderer/src/components/code/BottomPanel.vue`
- Modify: `src/renderer/src/components/code/CodeView.vue`（把 workDir 传给 BottomPanel，并透传可见性）
- Modify: `src/renderer/src/views/HomeView.vue`（把「文件」子页的可见性传给 CodeView）

**本任务顺带修掉一个 Phase 1 遗留缺陷**：`ProjectTerminal` 的启动闸门从未真正生效。它拿到的 `visible` 是 `!collapsed && activeTab === 'terminal'`，而 Phase 1 里 `activeTab` 恒为 `'terminal'`、`collapsed` 默认 `false`，所以该表达式恒为 `true`；`CodeView` 又被 `HomeView` 用 `v-show` 常挂载。结果是**会话一打开就 spawn 一个 shell 进程**，与用户是否点开「文件」子页无关。修法是把子页可见性沿 `HomeView → CodeView → BottomPanel` 透传下来，AND 进 `ProjectTerminal` 的 `visible`。

**Interfaces:**
- Consumes: Task 5 的 `useGitStore()`；`useFilesStore()` 的 `openDiff()`
- Produces: `GitPanel.vue`，无 props（自己从两个 store 读），内部 emit 无

**交互约定**：点击变更文件行 → 调 `files.openDiff(relPath, rev)`（Task 8 实现），在编辑器区打开 diff。

- [ ] **Step 1: 实现 GitPanel.vue**

创建 `src/renderer/src/components/code/GitPanel.vue`：

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../Icon.vue'
import { useGitStore } from '../../stores/git'
import { useFilesStore } from '../../stores/files'
import type { GitFileChange } from '../../composables/useElectron'

const git = useGitStore()
const files = useFilesStore()

const message = ref('')
const committing = ref(false)

interface Group {
  key: 'conflicted' | 'staged' | 'unstaged' | 'untracked'
  label: string
  items: GitFileChange[]
}

const groups = computed<Group[]>(() => {
  const s = git.status
  if (!s) return []
  return [
    { key: 'conflicted', label: '冲突', items: s.conflicted },
    { key: 'staged', label: '暂存的更改', items: s.staged },
    { key: 'unstaged', label: '更改', items: s.unstaged },
    { key: 'untracked', label: '未跟踪', items: s.untracked },
  ].filter((g) => g.items.length > 0)
})

const statusLabel: Record<GitFileChange['status'], string> = {
  M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', U: 'U', '?': 'U',
}

/** 点击变更行 → 在编辑器区打开 diff。未暂存/未跟踪对比 HEAD↔工作区；
 *  已暂存对比 HEAD↔index。 */
function openDiff(f: GitFileChange, group: Group['key']) {
  const rev = group === 'staged' ? ':0' : 'HEAD'
  files.openDiff(f.path, rev)
}

function onStage(f: GitFileChange) {
  void git.stage([f.path])
}

function onUnstage(f: GitFileChange) {
  void git.unstage([f.path])
}

async function onDiscard(f: GitFileChange) {
  // 丢弃不可逆：必须二次确认，且文案列出具体文件
  const label = f.status === '?' ? `删除未跟踪文件「${f.path}」` : `放弃「${f.path}」的改动`
  if (!window.confirm(`${label}？此操作不可撤销。`)) return
  await git.discard([f.path])
}

async function onCommit() {
  if (committing.value || !message.value.trim()) return
  committing.value = true
  try {
    await git.commit(message.value)
    // 只有提交成功（暂存区被清空）才清空输入框
    if (!git.hasStaged) message.value = ''
  } finally {
    committing.value = false
  }
}

const remoteBusy = (op: string) => git.busyOp === op
</script>

<template>
  <div class="git-panel">
    <!-- 顶部状态条：分支 + ahead/behind + 远程操作 -->
    <div class="git-bar">
      <Icon name="git-branch" :size="13" />
      <span class="branch" :title="git.status?.tracking ?? ''">
        {{ git.status?.branch ?? '—' }}
      </span>
      <span v-if="(git.status?.ahead ?? 0) > 0" class="ahead">↑{{ git.status?.ahead }}</span>
      <span v-if="(git.status?.behind ?? 0) > 0" class="behind">↓{{ git.status?.behind }}</span>
      <span class="bar-spacer" />
      <button class="bar-btn" title="fetch" :disabled="!!git.busyOp" @click="git.runRemoteOp('fetch')">
        <Icon name="refresh-cw" :size="13" />
      </button>
      <button class="bar-btn" title="pull" :disabled="!!git.busyOp" @click="git.runRemoteOp('pull')">
        <Icon name="arrow-down" :size="13" />
      </button>
      <button class="bar-btn" title="push" :disabled="!!git.busyOp" @click="git.runRemoteOp('push')">
        <Icon name="arrow-up" :size="13" />
      </button>
    </div>

    <!-- 变更列表 -->
    <div class="change-list">
      <div v-if="!git.status?.isRepo" class="empty">当前目录不是 Git 仓库</div>
      <div v-else-if="git.totalChanges === 0" class="empty">工作区干净，没有待提交的变更</div>
      <template v-else>
        <div v-for="g in groups" :key="g.key" class="group">
          <div class="group-title">{{ g.label }} ({{ g.items.length }})</div>
          <div
            v-for="f in g.items"
            :key="g.key + ':' + f.path"
            class="row"
            :title="f.path"
            @click="openDiff(f, g.key)"
          >
            <span class="st" :class="'st-' + g.key">{{ statusLabel[f.status] }}</span>
            <span class="path">{{ f.path }}</span>
            <span class="row-actions">
              <button
                v-if="g.key === 'staged'"
                class="mini"
                title="取消暂存"
                @click.stop="onUnstage(f)"
              >
                <Icon name="minus" :size="12" />
              </button>
              <button v-else class="mini" title="暂存" @click.stop="onStage(f)">
                <Icon name="plus" :size="12" />
              </button>
              <button class="mini danger" title="丢弃改动" @click.stop="onDiscard(f)">
                <Icon name="undo-2" :size="12" />
              </button>
            </span>
          </div>
        </div>
      </template>
    </div>

    <!-- 提交表单 -->
    <div class="commit-bar">
      <textarea
        v-model="message"
        class="msg"
        rows="1"
        placeholder="提交说明（Ctrl+Enter 提交）"
        @keydown.ctrl.enter.prevent="onCommit"
      />
      <button
        class="commit-btn"
        :disabled="!git.hasStaged || !message.trim() || committing"
        @click="onCommit"
      >
        <Icon name="check" :size="13" /> 提交
      </button>
    </div>
  </div>
</template>

<style scoped>
.git-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.git-bar {
  height: 30px;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.branch { color: var(--text-primary); }
.ahead { color: var(--status-ok); }
.behind { color: var(--status-warn); }
.bar-spacer { flex: 1; }
.bar-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.bar-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }
.bar-btn:disabled { opacity: 0.4; cursor: default; }
.change-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
}
.empty {
  padding: 16px;
  text-align: center;
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.group-title {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  font-size: var(--fs-caption);
  color: var(--text-primary);
  cursor: pointer;
}
.row:hover { background: var(--code-hover); }
.st {
  width: 12px;
  flex-shrink: 0;
  font-weight: 600;
  text-align: center;
}
.st-conflicted { color: var(--status-error); }
.st-staged { color: var(--status-ok); }
.st-unstaged { color: var(--status-warn); }
.st-untracked { color: var(--text-tertiary); }
.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.row-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.row:hover .row-actions { display: inline-flex; }
.mini {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.mini:hover { background: var(--bg-hover); color: var(--text-primary); }
.mini.danger:hover { color: var(--status-error); }
.commit-bar {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
}
.msg {
  flex: 1;
  min-width: 0;
  max-height: 80px;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--fs-caption);
  resize: vertical;
}
.msg:focus { outline: none; border-color: var(--border-focus); }
.commit-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--text-inverse);
  font-size: var(--fs-caption);
  cursor: pointer;
}
.commit-btn:disabled { opacity: 0.4; cursor: default; }
</style>
```

> **图标检查（必做）**：上面用到 `git-branch`、`refresh-cw`、`arrow-up`、`arrow-down`、`plus`、`minus`、`undo-2`、`check`。其中 `refresh-cw`、`plus`、`check`、`arrow-up`、`arrow-down`、`minus` 大概率已注册，但 `git-branch` 与 `undo-2` 未必。**动手前先 grep `src/renderer/src/components/Icon.vue`**，缺哪个就按现有风格补（从 `@lucide/vue` import PascalCase 名，如 `GitBranch` / `Undo2`，注册表里 kebab-case 键要加引号）。

- [ ] **Step 2: BottomPanel 接入 Git 标签**

`src/renderer/src/components/code/BottomPanel.vue` 里 `activeTab` 目前是 `ref<'terminal'>('terminal')`。改为：

```ts
// Git 更常用，作为展开后的默认标签
const activeTab = ref<'git' | 'terminal'>('git')
```

模板的 `.panel-bar` 展开态分支里，把单个 `panel-tab` 换成两个：

```vue
        <button
          class="panel-tab"
          :class="{ active: activeTab === 'git' }"
          @click="activeTab = 'git'"
        >
          <Icon name="git-branch" :size="13" /> Git
          <span v-if="gitBadge > 0" class="tab-badge">{{ gitBadge }}</span>
        </button>
        <button
          class="panel-tab"
          :class="{ active: activeTab === 'terminal' }"
          @click="activeTab = 'terminal'"
        >
          <Icon name="terminal" :size="13" /> 终端
        </button>
```

折叠态的 `.bar-expand` 按钮里显示的图标/文字改为跟随 `activeTab`：

```vue
          <Icon :name="activeTab === 'git' ? 'git-branch' : 'terminal'" :size="13" />
          <span>{{ activeTab === 'git' ? 'Git' : '终端' }}</span>
```

`.panel-body` 内部改为两个互斥面板（**都用 `v-show`，终端实例必须常驻**）：

```vue
    <div v-show="!collapsed" class="panel-body">
      <GitPanel v-show="activeTab === 'git'" />
      <ProjectTerminal
        v-show="activeTab === 'terminal'"
        :session-id="props.sessionId"
        :work-dir="props.workDir"
        :visible="!collapsed && activeTab === 'terminal'"
      />
    </div>
```

script 里补：

```ts
import GitPanel from './GitPanel.vue'
import { useGitStore } from '../../stores/git'

const gitStore = useGitStore()
/** 标签上的变更数徽章 */
const gitBadge = computed(() => gitStore.totalChanges)
```

（`computed` 要加进 `vue` 的 import。）

新增样式：

```css
.panel-tab .tab-badge {
  margin-left: 2px;
  padding: 0 4px;
  border-radius: 7px;
  background: var(--accent-soft-bg);
  color: var(--text-primary);
  font-size: 10px;
}
```

- [ ] **Step 3: CodeView 传 workDir、透传可见性并驱动 git store**

`src/renderer/src/components/code/CodeView.vue`：

1. script 里补 import 与 store：

```ts
import { watch } from 'vue'
import { useGitStore } from '../../stores/git'

const gitStore = useGitStore()

// 会话切换 → git 面板跟着换目录并重挂 .git watcher
watch(
  () => store.workDir,
  (wd) => { void gitStore.setSession(wd) },
  { immediate: true },
)
```

（`watch` 要加进 `vue` 的 import；`computed, onBeforeUnmount, ref` 已有。）

2. 加 props（CodeView 原先没有 props）：

```ts
/** 「文件」子页当前是否可见。由 HomeView 传入 —— CodeView 被 v-show 常挂载，
 *  自身感知不到子页切换，而底部面板的终端要据此决定是否启动。 */
const props = withDefaults(defineProps<{ visible?: boolean }>(), { visible: true })
```

3. 模板里 `BottomPanel` 加上可见性透传：

```vue
    <BottomPanel
      :session-id="store.currentSessionId"
      :work-dir="store.workDir"
      :visible="props.visible"
    />
```

- [ ] **Step 4: HomeView 把子页可见性传下去**

`src/renderer/src/views/HomeView.vue` 里渲染 `CodeView` 的那处（`v-show="activeSubTab === 'code'"` 的 `.sub-pane` 内）：

```vue
              <div v-show="activeSubTab === 'code'" class="sub-pane">
                <CodeView :visible="activeSubTab === 'code'" />
              </div>
```

- [ ] **Step 5: BottomPanel 的 visible 合并三条件**

（本步会**改写 Step 2 里 `ProjectTerminal` 上的 `:visible`** —— Step 2 先按原样写上，这里再补全可见性条件。）

`BottomPanel.vue` 加 prop：

```ts
const props = defineProps<{
  sessionId: string
  workDir: string
  /** 「文件」子页是否可见（由 CodeView 透传） */
  visible?: boolean
}>()
```

传给 `ProjectTerminal` 的 `visible` 改为三者相与：

```vue
      <ProjectTerminal
        v-show="activeTab === 'terminal'"
        :session-id="props.sessionId"
        :work-dir="props.workDir"
        :visible="(props.visible ?? true) && !collapsed && activeTab === 'terminal'"
      />
```

这样终端只在「用户确实看得见它」时启动：文件子页处于激活状态、面板未折叠、且当前选中的是终端标签。面板折叠（默认态）时不启动，切到 Trace/终端子页时不启动，会话切换后如果面板一直没展开也不会启动。

- [ ] **Step 6: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`

再回到仓库根目录运行：`npm run test:main`

Expected: 全部通过

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/components/code/GitPanel.vue src/renderer/src/components/code/BottomPanel.vue src/renderer/src/components/code/CodeView.vue src/renderer/src/views/HomeView.vue
git commit -m "feat: 底部面板新增 Git 标签与变更列表，并修正终端启动闸门"
```

---

## Task 7: 抽出 Monaco 初始化模块（纯重构）

**Files:**
- Create: `src/renderer/src/monaco/setup.ts`
- Modify: `src/renderer/src/components/code/CodeEditor.vue`

**Interfaces:**
- Consumes: `monaco-editor` 0.56 与它的 5 个 worker
- Produces:
  - `ensureMonaco(): Promise<Monaco | null>`
  - `buildMonacoTheme(monaco: Monaco, themeId: string): string`
  - `applyMonacoTheme(monaco: Monaco, theme: string): string`（设置 `data-term-theme` 属性、构建并返回主题名）
  - `type Monaco = typeof import('monaco-editor')`

**为什么需要**：Task 8 的 `CodeDiffView.vue` 也要创建 Monaco 实例。Monaco 的 worker 初始化（`self.MonacoEnvironment`）必须是**全局一次性**的，否则 diff 视图单独挂载时会因为没有 worker 而语言功能失效。把初始化与主题构建抽成共享模块，避免第二份实现。

**这是纯重构：`CodeEditor.vue` 的行为必须完全不变。**

- [ ] **Step 1: 创建 monaco/setup.ts**

把 `CodeEditor.vue` 现有的 `editorWorker`/`jsonWorker`/`cssWorker`/`htmlWorker`/`tsWorker` 导入（含那段关于 `exports` 映射与 Vite/Rolldown 的注释）、`cssVar()`、`currentThemeId()`、`buildMonacoTheme()`、`ensureMonaco()`、`applyMonacoTheme()` 全部**逐字**搬到新建的 `src/renderer/src/monaco/setup.ts`，只做两处调整：

1. 给 `ensureMonaco`、`buildMonacoTheme`、`applyMonacoTheme`、`cssVar`、`currentThemeId` 加上 `export`（`applyMonacoTheme` 需要接收 monaco 实例参数，签名改为 `applyMonacoTheme(monaco: Monaco, theme: string): string`）
2. 导出 `type Monaco = typeof import('monaco-editor')`

原 `CodeEditor.vue` 里的 `applyMonacoTheme()` 是不带参数的（依赖组件内的 `settings` store）。搬过去以后改为纯函数：接收 `theme` 字符串（调用方从 `settings.cfg?.terminal.theme` 取），内部仍先 `document.documentElement.setAttribute('data-term-theme', theme)` 再构建主题，**返回主题名**，由调用方决定是否 `monaco.editor.setTheme()`。

- [ ] **Step 2: 改 CodeEditor.vue 引入**

删除 `CodeEditor.vue` 中被搬走的定义（worker 导入、`cssVar`、`currentThemeId`、`buildMonacoTheme`、`ensureMonaco`、`applyMonacoTheme`）与 `type Monaco` 声明，改为：

```ts
import { ensureMonaco, applyMonacoTheme } from '../../monaco/setup'
```

组件内的 `applyMonacoTheme` 调用点（`ensureEditor` 与主题 watch）改为：

```ts
async function applyThemeToEditor() {
  const m = await ensureMonaco()
  if (!m) return
  const theme = settings.cfg?.terminal.theme ?? currentThemeId()
  currentThemeName = applyMonacoTheme(m, theme)
  if (editor) m.editor.setTheme(currentThemeName)
}
```

（`currentThemeId` 也要从 `monaco/setup` 导入 —— 若决定不导出它，则用 `document.documentElement.getAttribute('data-term-theme') || 'default-dark'` 就地取。）

- [ ] **Step 3: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: 手工回归（无法自动化，由控制器安排）**

在 `npm run dev` 里打开一个文件确认：能正常显示内容、语法高亮在、切换终端主题时编辑器配色跟着变、Ctrl+S 能保存。跳过则记为「需人工确认」。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/monaco/setup.ts src/renderer/src/components/code/CodeEditor.vue
git commit -m "refactor: 抽出 monaco/setup.ts 供编辑器与 diff 视图共用"
```

---

## Task 8: `CodeDiffView.vue` 与编辑器区 diff 切换

**Files:**
- Create: `src/renderer/src/components/code/CodeDiffView.vue`
- Modify: `src/renderer/src/stores/files.ts`（新增 `diffRequest` / `openDiff` / `closeDiff`）
- Modify: `src/renderer/src/components/code/CodeView.vue`（编辑器区切换）

**Interfaces:**
- Consumes: Task 7 的 `ensureMonaco` / `applyMonacoTheme`；Task 4 的 `GitFileAtRev`；`useFilesStore` 的 `workDir`
- Produces:
  - `useFilesStore()` 新增：`diffRequest: Ref<{ relPath: string; rev: string } | null>`、`openDiff(relPath: string, rev: string): void`、`closeDiff(): void`
  - `CodeDiffView.vue`：无 props（从 store 读 `diffRequest` 与 `workDir`）

**diff 两侧内容的取法**：

| 场景 | 左侧（原始） | 右侧（修改后） |
|---|---|---|
| 未暂存 / 未跟踪（`rev = 'HEAD'`） | `GitFileAtRev(workDir, 'HEAD', p)` | 工作区文件（`FileRead(workDir, p)`） |
| 已暂存（`rev = ':0'`） | `GitFileAtRev(workDir, 'HEAD', p)` | `GitFileAtRev(workDir, ':0', p)` |

即：右侧的 `rev` 为 `':0'` 时取 index 内容，否则读工作区文件。

- [ ] **Step 1: files store 新增 diff 状态**

在 `src/renderer/src/stores/files.ts` 里：

1. 在 `rootCreateRequest` 声明附近加：

```ts
  /** 当前要在编辑器区展示的 diff（null = 显示普通编辑器） */
  const diffRequest = ref<{ relPath: string; rev: string } | null>(null)
```

2. 在 `setSession` 里（切换会话时清掉 diff，避免显示上一个目录的文件），紧挨 `workDir.value = wd` 之后加：

```ts
    diffRequest.value = null
```

3. 新增两个动作：

```ts
  /** 在编辑器区打开某个文件的 diff。rev 为 ':0' 表示对比暂存区，'HEAD' 表示对比最后一次提交 */
  function openDiff(relPath: string, rev: string) {
    diffRequest.value = { relPath, rev }
  }

  function closeDiff() {
    diffRequest.value = null
  }
```

4. 在 store 的 `return { ... }` 里加上 `diffRequest, openDiff, closeDiff`。

- [ ] **Step 2: 实现 CodeDiffView.vue**

创建 `src/renderer/src/components/code/CodeDiffView.vue`：

```vue
<script setup lang="ts">
import { onBeforeUnmount, ref, watch, nextTick } from 'vue'
import Icon from '../Icon.vue'
import { FileRead, GitFileAtRev } from '../../composables/useElectron'
import { useFilesStore } from '../../stores/files'
import { useSettingsStore } from '../../stores/settings'
import { ensureMonaco, applyMonacoTheme } from '../../monaco/setup'

type DiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor
type ITextModel = import('monaco-editor').editor.ITextModel

const files = useFilesStore()
const settings = useSettingsStore()

const hostEl = ref<HTMLElement | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const notice = ref('') // 二进制 / 超大文件提示

let diffEditor: DiffEditor | null = null
let originalModel: ITextModel | null = null
let modifiedModel: ITextModel | null = null
let currentThemeName = 'code-default-dark'

function languageFor(relPath: string): string {
  if (relPath.endsWith('.ts') || relPath.endsWith('.tsx')) return 'typescript'
  if (relPath.endsWith('.js') || relPath.endsWith('.jsx')) return 'javascript'
  if (relPath.endsWith('.vue')) return 'html'
  if (relPath.endsWith('.json')) return 'json'
  if (relPath.endsWith('.md')) return 'markdown'
  if (relPath.endsWith('.py')) return 'python'
  if (relPath.endsWith('.css')) return 'css'
  if (relPath.endsWith('.html')) return 'html'
  return 'plaintext'
}

/** 应用到 Monaco 主题：与 CodeEditor 同源（都读 --term-*） */
async function syncTheme() {
  const m = await ensureMonaco()
  if (!m) return
  const theme = settings.cfg?.terminal.theme ?? 'default-dark'
  currentThemeName = applyMonacoTheme(m, theme)
  m.editor.setTheme(currentThemeName)
}

async function ensureEditor(): Promise<DiffEditor | null> {
  const m = await ensureMonaco()
  const el = hostEl.value
  if (!m || !el) return null
  if (diffEditor) return diffEditor
  if (!settings.cfg) await settings.load()
  await syncTheme()
  diffEditor = m.editor.createDiffEditor(el, {
    theme: currentThemeName,
    automaticLayout: true,
    readOnly: true,
    renderSideBySide: true,
    fontSize: settings.cfg?.code?.fontSize ?? 12,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
  })
  return diffEditor
}

function disposeModels() {
  originalModel?.dispose()
  modifiedModel?.dispose()
  originalModel = null
  modifiedModel = null
}

async function load() {
  const req = files.diffRequest
  const wd = files.workDir
  if (!req || !wd) return

  const ed = await ensureEditor()
  // 必须重新 await ensureMonaco()，不能读模块级的 monacoModule ——
  // watch 触发的 load 可能早于组件首次挂载时那次赋值的完成
  const m = await ensureMonaco()
  if (!ed || !m) return

  loading.value = true
  errorMsg.value = ''
  notice.value = ''
  disposeModels()

  try {
    const [left, right] = await Promise.all([
      GitFileAtRev(wd, 'HEAD', req.relPath),
      req.rev === ':0' ? GitFileAtRev(wd, ':0', req.relPath) : FileRead(wd, req.relPath),
    ])

    // 左侧不存在是正常的（新增文件还没提交过）→ 用空内容
    const leftOk = left.ok
    const rightOk = right.ok
    if (!rightOk && req.rev === ':0') {
      errorMsg.value = right.error
      return
    }

    const leftBinary = leftOk && left.binary
    const rightBinary = right.ok && (right as any).binary
    if (leftBinary || rightBinary) {
      notice.value = '二进制文件，无法显示 diff'
      return
    }
    const leftTruncated = leftOk && left.truncated
    const rightTruncated = right.ok && (right as any).truncated
    if (leftTruncated || rightTruncated) {
      notice.value = '文件过大，仅显示截断内容'
    }

    const lang = languageFor(req.relPath)
    const uriBase = `file:///${req.relPath}`
    originalModel = m.editor.createModel(
      leftOk ? left.content : '',
      lang,
      m.Uri.parse(`${uriBase}?rev=HEAD`),
    )
    modifiedModel = m.editor.createModel(
      right.ok ? (right as any).content : '',
      lang,
      m.Uri.parse(`${uriBase}?rev=${req.rev}`),
    )
    ed.setModel({ original: originalModel, modified: modifiedModel })
  } catch (e: any) {
    errorMsg.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
}

// diff 请求变化 → 重新加载；workDir 变化（切会话）时 store 已清空 diffRequest
watch(() => files.diffRequest, async () => {
  await nextTick()
  await load()
}, { deep: true })

watch(() => settings.cfg?.terminal.theme, () => { void syncTheme() })

onBeforeUnmount(() => {
  disposeModels()
  diffEditor?.dispose()
  diffEditor = null
})

// 首次挂载。父组件用 v-show 控制显隐，所以本组件拿到 diffRequest 时已经非空
void (async () => {
  await ensureMonaco()
  await nextTick()
  await load()
})()
</script>

<template>
  <div class="diff-view">
    <div class="diff-bar">
      <Icon name="git-compare" :size="13" />
      <span class="diff-path" :title="files.diffRequest?.relPath ?? ''">
        {{ files.diffRequest?.relPath }}
      </span>
      <span class="diff-rev">{{ files.diffRequest?.rev === ':0' ? '暂存区' : '工作区' }} ↔ HEAD</span>
      <span class="bar-spacer" />
      <button class="bar-btn" title="关闭 diff" @click="files.closeDiff()">
        <Icon name="close" :size="13" />
      </button>
    </div>
    <div v-if="loading" class="diff-hint">正在加载…</div>
    <div v-else-if="errorMsg" class="diff-hint error">{{ errorMsg }}</div>
    <div v-else-if="notice" class="diff-hint">{{ notice }}</div>
    <div ref="hostEl" class="diff-host" />
  </div>
</template>

<style scoped>
.diff-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}
.diff-bar {
  height: 32px;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  user-select: none;
}
.diff-path { color: var(--text-primary); }
.diff-rev { color: var(--text-tertiary); }
.bar-spacer { flex: 1; }
.bar-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.bar-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
.diff-hint {
  padding: 8px 12px;
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.diff-hint.error { color: var(--status-error); }
.diff-host {
  flex: 1;
  min-height: 0;
}
</style>
```

> **图标检查（必做）**：用到 `git-compare`、`close`。先 grep `Icon.vue` 确认；`close` 已注册（FileTabs 用过），`git-compare` 未必 —— 缺则补注册（`GitCompare`）。

- [ ] **Step 3: CodeView 编辑器区切换**

`src/renderer/src/components/code/CodeView.vue` 里，把 `.editor-panel` 内部改为（**用 `v-show` 保留两个组件的实例，避免 Monaco 反复重建**）：

```vue
      <section class="editor-panel">
        <div v-show="!store.diffRequest" class="editor-slot">
          <FileTabs />
          <CodeEditor />
        </div>
        <div v-show="!!store.diffRequest" class="editor-slot">
          <CodeDiffView />
        </div>
      </section>
```

import 区补 `import CodeDiffView from './CodeDiffView.vue'`。

样式补：

```css
.editor-slot {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

（`.editor-panel` 已有 `flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column;`，两个 `.editor-slot` 各自占满。）

- [ ] **Step 4: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`，再回根目录 `npm run test:main`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/stores/files.ts src/renderer/src/components/code/CodeDiffView.vue src/renderer/src/components/code/CodeView.vue
git commit -m "feat: 编辑器区支持 Git diff 视图"
```

---

## 完成标准

Phase 2 完成的判定：

1. 底部面板展开后可见「Git」标签，标签上有变更数徽章；「终端」标签功能不受影响
2. Git 面板显示当前分支、ahead/behind、四个分组的变更列表
3. 点击变更文件行，编辑器区打开该文件的 diff（未暂存对比工作区、已暂存对比暂存区），可关闭
4. 暂存 / 取消暂存 / 丢弃（含二次确认）都生效，列表自动刷新
5. 写 commit message 能提交，提交后列表与输入框状态正确
6. fetch / pull / push 可用，操作中按钮禁用，失败有 toast
7. 在终端里执行 git 命令（或外部改文件后 `git add`）时，Git 面板自动刷新（`.git` watcher）
8. 非 Git 仓库时显示空状态文案，不报错
9. `npm run test:main`、`npx tsc --noEmit`、`npx vue-tsc --noEmit` 全绿

## 已知不做的（留给 Phase 3 或终端）

- 提交历史图（设计文档的 30% / 70% 横向分栏届时一并调整）
- 分支切换、stash、rebase、冲突解决 UI
- 单文件的行级暂存（`git add -p`）
