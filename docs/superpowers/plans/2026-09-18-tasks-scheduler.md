# 定时任务（Tasks）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Lynel Desktop 左栏「收藏夹」上方新增「任务」入口，提供定时任务：按 cron 周期无头执行 `claude -p --output-format stream-json`，把完整事件流落到 SQLite 并在 UI 中回放。

**Architecture:** 主进程新增 `src/main/tasks/` 模块（`paths` / `db` / `store` / `schedule` / `streamParse` / `runner` / `scheduler` / `index`），以前端 `updater/index.ts` 的单例风格挂载；渲染层新增 `components/tasks/` 的三段式面板（任务列表 + 详情 + 运行流水）。所有任务共用一个固定工作目录 `~/.lynel-desktop/tasks/`，任务会话的 jsonl 由 Lynel 侧从会话扫描中排除。

**Tech Stack:** Electron 43.0.0（Node 24.17.0）/ TypeScript / Vue 3 + Pinia / `node:sqlite`（Node 内置，实测可用）/ `croner@10`（零依赖）/ `tree-kill`（已有依赖）/ vitest 2（测试跑 `tests/main`）

## Global Constraints

以下要求适用于**每一个** task，不再重复：

- **唯一真相源**：`docs/superpowers/specs/2026-09-18-tasks-scheduler-design.md`。本计划与 spec 冲突处以 spec 为准。
- **设计稿**：`docs/superpowers/specs/2026-09-18-tasks-scheduler-design-mockup.html`。UI 的配色 / 间距 / 圆角 / 字重一律照抄对应 section；样式**只用** `src/renderer/src/styles/theme.css` 的 CSS 变量，**禁止硬编码颜色**。
- **真实样本 fixture**：`tests/main/tasks/fixtures/stream-sample.jsonl`（9 行，已脱敏，覆盖 C1–C5 全部坑位）。解析类测试必须用它，不要手写假样本。
- **实测基准**：claude CLI 2.1.114 / Electron 43.0.0 / Node 24.17.0。
- **import 扩展名**：`src/main/**` 内部与测试里 import 主进程模块一律带 `.js` 后缀（例：`from '../../src/main/tasks/paths.js'`）；渲染层 import 不带后缀。
- **命令**（每个 task 的 commit 前必须全绿）：
  - `npm run test:main`（= `vitest run --dir tests/main`）
  - `cd src/renderer && npx vue-tsc --noEmit`
- **提交**：一个 task 一个 commit，格式 `<type>: <subject>`，type ∈ `feat`/`fix`/`refactor`/`test`/`docs`/`chore`/`ci`。提交前设 local identity：`git config user.name "<name>"` 与 `git config user.email "<email>"`。
- **禁止**提交构建产物、诊断文件、临时脚本。
- **禁止**修改全局 `~/.claude/settings.json`；**禁止**使用 `CLAUDE_CONFIG_DIR`（理由见 spec D11）。
- **主进程错误处理**：返回 `error` / reject，不要抛未捕获异常（未捕获异常会导致窗口白屏）。
- **IPC 分层**：只有 `src/main/preload.ts` 与 `src/renderer/src/composables/useElectron.ts` 能碰 `ipcRenderer` / `window.electronAPI`。组件一律 `import { X } from '../composables/useElectron'`。
- **图标**：用 `@lucide/vue` 经 `src/renderer/src/components/Icon.vue` 引用；**新增图标前必须先查 `Icon.vue` 的 `icons` 映射确认键已注册**，未注册按现有风格补（import 一行 + 映射一行）。禁止 emoji / Unicode 符号当图标。
- **Pinia**：setup style；`ref<Record<K,V>>` 更新用整体 spread。
- **测试隔离**：涉及 electron 的模块在测试里 `vi.mock('electron', () => ({ safeStorage: {}, app: {} }))`；文件系统一律走 `fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-'))`。

## 实测结论速查（写代码时直接依赖）

| 结论 | 值 |
|---|---|
| `node:sqlite` 在 Electron 43 主进程 | **可用**。exports：`DatabaseSync` / `StatementSync` / `Session` / `constants` / `backup` |
| `-p --output-format stream-json` | **必须**同时带 `--verbose`，否则报错 |
| `-p` 的 stdin | 会**等最多 3 秒**；必须 `stdio: ['ignore','pipe','pipe']`，否则每次 run 白等 3 秒（用 `pipe` 不关则永久卡住） |
| `--resume <不存在的 uuid>` | exit 1；stdout 有 `result{subtype:"error_during_execution", is_error:true, num_turns:0, total_cost_usd:0}`；stderr 有 `No conversation found with session ID: <uuid>`。**该 result 里的 `session_id` 是新的随机 UUID，绝不能写回 `tasks.session_id`** |
| `--session-id <非 UUID>` | exit 1，stderr `Error: Invalid session ID. Must be a valid UUID.` |
| 全局 hooks 在 `-p` 下 | **会触发**。真实流开头两行就是 `system/hook_started` + `system/hook_response` |
| `assistant` 事件粒度 | **一个 content block 一行**，同一 `message.id` 跨多行（样本 4 行 / 2 个 id） |
| `tool_use.id` | 实测 `call_00_1wClu5X4x87ixrpzM3Wr1570`（第三方 base_url）。**不要假设 `toolu_` 前缀** |
| `tool_result.content` | 实测为**字符串**，也可能是数组或 null |
| `usage` | **不是扁平 map**，含嵌套对象与字符串字段；必须白名单取值 |

## 文件结构

**主进程（新增）**

| 文件 | 职责 |
|---|---|
| `src/main/tasks/paths.ts` | `tasksDir()` / `ensureTasksDir()` + 目录内初始 `CLAUDE.md` |
| `src/main/tasks/db.ts` | `node:sqlite` 的**唯一接触点**：惰性打开 / PRAGMA / schema migration / close |
| `src/main/tasks/schedule.ts` | **纯函数**：预设↔cron 互转 / `computeNextRun` / `isDue` + 三个时间常量 |
| `src/main/tasks/streamParse.ts` | **纯函数**：NDJSON 行 → `NormalizedEvent`（含 C3 多态归一化、C5 usage 白名单）+ `isResumeMissing` |
| `src/main/tasks/store.ts` | 三表 CRUD + 状态机 + 启动恢复（无业务逻辑） |
| `src/main/tasks/runner.ts` | 单次 run：spawn / 逐行消费 / 落库 / 推送 / 超时 / resume 回退 |
| `src/main/tasks/scheduler.ts` | 30s tick / 队列 / 并发闸门 / 启动恢复编排 |
| `src/main/tasks/index.ts` | `initTasks()` / `tasksShutdown()` / IPC 注册 |

**主进程（修改）**：`src/main/app.ts`（启动接线 + shutdown）、`src/main/jsonl.ts`（扫描排除）、`src/main/preload.ts`、`package.json`（加 `croner`）

**渲染层（新增）**：`components/tasks/{TasksPane,TaskList,TaskDetailPane,TaskFormDialog,RunStreamView,ToolStepCard}.vue`、`stores/tasks.ts`、`utils/tasks.ts`、`types/tasks.ts`

**渲染层（修改）**：`views/HomeView.vue`、`types/tab.ts`、`stores/tabs.ts`、`components/GlobalTabs.vue`、`components/Icon.vue`、`composables/useElectron.ts`

**测试（新增）**：`tests/main/tasks/{paths,db,store,schedule,streamParse,flatten}.test.ts`

---

## Task 1: tasks 目录解析与初始化（`paths.ts`）

**Files:**
- Create: `src/main/tasks/paths.ts`
- Test: `tests/main/tasks/paths.test.ts`

**Interfaces:**
- Consumes: `src/main/store.ts` 的 `getStore(name)`
- Produces:
  - `DEFAULT_TASKS_DIR: string`
  - `resolveTasksDir(configured: unknown): string`
  - `tasksDir(): string`
  - `ensureTasksDir(dir?: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/tasks/paths.test.ts
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTasksDir, ensureTasksDir, DEFAULT_TASKS_DIR } from '../../../src/main/tasks/paths.js';

vi.mock('electron', () => ({ safeStorage: {} }));

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-'));
}

describe('resolveTasksDir', () => {
  it('空值 / 非字符串 / 纯空白都回退到默认目录', () => {
    expect(resolveTasksDir(undefined)).toBe(DEFAULT_TASKS_DIR);
    expect(resolveTasksDir(null)).toBe(DEFAULT_TASKS_DIR);
    expect(resolveTasksDir(123)).toBe(DEFAULT_TASKS_DIR);
    expect(resolveTasksDir('')).toBe(DEFAULT_TASKS_DIR);
    expect(resolveTasksDir('   ')).toBe(DEFAULT_TASKS_DIR);
  });

  it('接受合法字符串并去掉首尾空白', () => {
    expect(resolveTasksDir('  /tmp/x  ')).toBe('/tmp/x');
  });
});

describe('ensureTasksDir', () => {
  it('创建目录并写入初始 CLAUDE.md', () => {
    const dir = path.join(tmpDir(), 'tasks');
    expect(fs.existsSync(dir)).toBe(false);
    const ret = ensureTasksDir(dir);
    expect(ret).toBe(dir);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(md).toContain('Lynel');
    expect(md).toContain('绝对路径');
  });

  it('不覆盖用户已改过的 CLAUDE.md', () => {
    const dir = path.join(tmpDir(), 'tasks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '用户自己写的内容', 'utf8');
    ensureTasksDir(dir);
    expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe('用户自己写的内容');
  });

  it('目录已存在时不报错（幂等）', () => {
    const dir = path.join(tmpDir(), 'tasks');
    ensureTasksDir(dir);
    expect(() => ensureTasksDir(dir)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- tests/main/tasks/paths.test.ts`
Expected: FAIL — `Failed to load url ../../../src/main/tasks/paths.js`（文件不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/tasks/paths.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getStore } from '../store.js';

/** 所有任务共用的工作目录默认值。不要改成安装目录：macOS 会破坏 .app 签名，
 *  electron-updater 升级会原地替换导致数据丢失，asar 内只读。 */
export const DEFAULT_TASKS_DIR = path.join(os.homedir(), '.lynel-desktop', 'tasks');

const TASKS_CLAUDE_MD = `# Lynel 定时任务工作目录

这是 Lynel 定时任务的固定工作目录，所有任务都在这里执行。

- 任务产物（报告、临时文件、脚本）放在这个目录里。
- 要操作其他项目，请在命令中使用**绝对路径**（例如 \`cd /g/work/myproj && npm test\`）。
  Bash 工具每次调用都是新 shell，\`cd\` 不会跨调用保持。
- 其他项目的 CLAUDE.md 不会被自动加载（它按当前工作目录发现）。
`;

export function resolveTasksDir(configured: unknown): string {
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  return DEFAULT_TASKS_DIR;
}

export function tasksDir(): string {
  return resolveTasksDir(getStore('settings').get('tasks_dir'));
}

/** 建目录 + 落初始 CLAUDE.md（已存在则不覆盖）。返回最终目录路径。 */
export function ensureTasksDir(dir: string = tasksDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  const md = path.join(dir, 'CLAUDE.md');
  if (!fs.existsSync(md)) {
    fs.writeFileSync(md, TASKS_CLAUDE_MD, 'utf8');
  }
  return dir;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- tests/main/tasks/paths.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: Commit**

```bash
git config user.name "walleliu1016" && git config user.email "walleliu1016@users.noreply.github.com"
git add src/main/tasks/paths.ts tests/main/tasks/paths.test.ts
git commit -m "feat: 新增定时任务工作目录解析与初始化"
```

---

## Task 2: SQLite 封装与 schema（`db.ts`）

**Files:**
- Create: `src/main/tasks/db.ts`
- Test: `tests/main/tasks/db.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `SCHEMA_VERSION: number`
  - `setDbFile(file: string | null): void`（测试用；传 `null` 关闭并清空）
  - `getDb(): DatabaseSync`（惰性打开 + migrate）
  - `closeDb(): void`
  - `migrate(db: DatabaseSync): void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/tasks/db.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, closeDb, setDbFile, migrate, SCHEMA_VERSION } from '../../../src/main/tasks/db.js';

vi.mock('electron', () => ({ safeStorage: {} }));

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-db-'));
  return path.join(dir, 'tasks.db');
}

afterEach(() => {
  closeDb();
  setDbFile(null);
});

describe('db', () => {
  it('创建三张表 + meta 表，并写入 schema 版本', () => {
    setDbFile(tmpFile());
    const db = getDb();
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(names).toEqual(expect.arrayContaining(['meta', 'run_events', 'runs', 'tasks']));
    const v = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as any;
    expect(Number(v.value)).toBe(SCHEMA_VERSION);
  });

  it('开启 WAL 模式', () => {
    setDbFile(tmpFile());
    const row = getDb().prepare('PRAGMA journal_mode').get() as any;
    expect(String(row.journal_mode).toLowerCase()).toBe('wal');
  });

  it('同一个文件重复 getDb 返回同一实例', () => {
    setDbFile(tmpFile());
    expect(getDb()).toBe(getDb());
  });

  it('migrate 幂等：跑两次不报错、版本不变', () => {
    setDbFile(tmpFile());
    const db = getDb();
    migrate(db);
    migrate(db);
    const v = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as any;
    expect(Number(v.value)).toBe(SCHEMA_VERSION);
  });

  it('closeDb 之后 getDb 能重新打开同一文件且数据还在', () => {
    const f = tmpFile();
    setDbFile(f);
    getDb().prepare("INSERT INTO tasks(id,name,enabled,prompt,agent,session_id,session_initialized,schedule_type,schedule_expr,run_at,next_run_at,last_run_at,last_status,created_at,updated_at) VALUES('t1','n',1,'p',NULL,NULL,0,'cron','0 9 * * *',NULL,NULL,NULL,NULL,1,1)").run();
    closeDb();
    const rows = getDb().prepare('SELECT id FROM tasks').all();
    expect(rows).toHaveLength(1);
  });

  it('run_events 主键 (run_id, seq) 约束生效', () => {
    setDbFile(tmpFile());
    const db = getDb();
    const ins = db.prepare('INSERT INTO run_events(run_id,seq,ts,type,subtype,payload) VALUES(?,?,?,?,?,?)');
    ins.run('r1', 0, 1, 'system', null, '{}');
    expect(() => ins.run('r1', 0, 1, 'system', null, '{}')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- tests/main/tasks/db.test.ts`
Expected: FAIL — 无法解析 `../../../src/main/tasks/db.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/tasks/db.ts
// node:sqlite 的唯一接触点。实测 Electron 43.0.0 / Node 24.17.0 可用；
// 它是 experimental API，所有 sqlite 依赖都收敛在本文件，便于将来换 better-sqlite3。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

export const DEFAULT_DB_FILE = path.join(os.homedir(), '.lynel-desktop', 'tasks.db');

let dbFile: string | null = DEFAULT_DB_FILE;
let db: DatabaseSync | null = null;

/** 测试/外部切换数据库文件。传 null 关闭当前连接并置空路径。 */
export function setDbFile(file: string | null): void {
  closeDb();
  dbFile = file;
}

export function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* 已关闭 / 文件已删，忽略 */
    }
    db = null;
  }
}

export function getDb(): DatabaseSync {
  if (db) return db;
  if (!dbFile) throw new Error('tasks db file 未设置');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const opened = new DatabaseSync(dbFile);
  opened.exec('PRAGMA journal_mode=WAL');
  opened.exec('PRAGMA foreign_keys=ON');
  migrate(opened);
  db = opened;
  return db;
}

export function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      prompt TEXT NOT NULL,
      agent TEXT,
      session_id TEXT,
      session_initialized INTEGER NOT NULL DEFAULT 0,
      schedule_type TEXT NOT NULL,
      schedule_expr TEXT,
      run_at INTEGER,
      next_run_at INTEGER,
      last_run_at INTEGER,
      last_status TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      queued_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      session_id TEXT,
      resume_used INTEGER,
      exit_code INTEGER,
      is_error INTEGER,
      result_subtype TEXT,
      result_text TEXT,
      num_turns INTEGER,
      duration_ms INTEGER,
      total_cost_usd REAL,
      usage_json TEXT,
      error TEXT,
      event_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    )
  `);

  database.exec('CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, queued_at DESC)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_tasks_next ON tasks(next_run_at)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)');

  database
    .prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING')
    .run('schema_version', String(SCHEMA_VERSION));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- tests/main/tasks/db.test.ts`
Expected: PASS（6 个用例）。可能会看到 `ExperimentalWarning: SQLite is an experimental feature` —— 无害，忽略。

- [ ] **Step 5: Commit**

```bash
git add src/main/tasks/db.ts tests/main/tasks/db.test.ts
git commit -m "feat: 新增定时任务 SQLite 封装与 schema"
```

---

## Task 3: 任务表 CRUD（`store.ts` 第一部分）

**Files:**
- Create: `src/main/tasks/store.ts`
- Test: `tests/main/tasks/store.test.ts`

**Interfaces:**
- Consumes: `getDb()`（Task 2）、`Schedule` / `computeNextRun`（Task 5 —— **本 task 先只写不依赖它的部分**，因此 `createTask` 的 `nextRunAt` 由调用方传入）
- Produces:
  - `TaskRow` / `CreateTaskInput`
  - `createTask(input: CreateTaskInput): TaskRow`
  - `getTask(id: string): TaskRow | null`
  - `listTasks(opts?: { enabledOnly?: boolean }): TaskRow[]`
  - `updateTask(id: string, patch: TaskPatch): TaskRow`
  - `deleteTask(id: string): void`
  - `setTaskSession(id: string, sessionId: string, initialized: boolean): void`
  - `touchTaskAfterRun(id: string, at: number, status: string): void`

```ts
export type TaskPatch = Partial<{
  name: string; prompt: string; enabled: boolean;
  scheduleType: 'cron' | 'once'; scheduleExpr: string | null; runAt: number | null;
  nextRunAt: number | null; lastRunAt: number | null; lastStatus: string | null;
}>;

export interface CreateTaskInput {
  name: string; prompt: string; sessionId: string;
  scheduleType: 'cron' | 'once'; scheduleExpr: string | null;
  runAt: number | null; nextRunAt: number | null;
  enabled?: boolean; agent?: string;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/tasks/store.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDbFile, closeDb } from '../../../src/main/tasks/db.js';
import {
  createTask, getTask, listTasks, updateTask, deleteTask,
  setTaskSession, touchTaskAfterRun,
} from '../../../src/main/tasks/store.js';

vi.mock('electron', () => ({ safeStorage: {} }));

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-store-'));
  setDbFile(path.join(dir, 'tasks.db'));
});
afterEach(() => {
  closeDb();
  setDbFile(null);
});

const base = {
  name: '每日巡检',
  prompt: '检查 CI',
  sessionId: '11111111-1111-4111-8111-111111111111',
  scheduleType: 'cron' as const,
  scheduleExpr: '0 9 * * *',
  runAt: null,
  nextRunAt: 1_700_000_000_000,
};

describe('tasks CRUD', () => {
  it('createTask 落库并回读全部字段', () => {
    const t = createTask(base);
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.enabled).toBe(1);
    expect(t.scheduleType).toBe('cron');
    expect(t.scheduleExpr).toBe('0 9 * * *');
    expect(t.nextRunAt).toBe(1_700_000_000_000);
    expect(t.sessionInitialized).toBe(0);
    expect(getTask(t.id)?.name).toBe('每日巡检');
  });

  it('默认 enabled=1，agent 默认 claude', () => {
    const t = createTask(base);
    expect(t.enabled).toBe(1);
    expect(t.agent).toBe('claude');
  });

  it('getTask 不存在返回 null', () => {
    expect(getTask('nope')).toBeNull();
  });

  it('listTasks 默认按 enabled 优先、再按 next_run_at 升序，null 沉底', () => {
    const a = createTask({ ...base, name: 'A', nextRunAt: 300 });
    const b = createTask({ ...base, name: 'B', nextRunAt: 100 });
    const c = createTask({ ...base, name: 'C', nextRunAt: null });
    updateTask(a.id, { enabled: false });
    const ids = listTasks().map((t) => t.id);
    expect(ids).toEqual([b.id, c.id, a.id]);
  });

  it('listTasks({enabledOnly}) 过滤停用任务', () => {
    const a = createTask(base);
    const b = createTask({ ...base, name: '另一个' });
    updateTask(a.id, { enabled: false });
    expect(listTasks({ enabledOnly: true }).map((t) => t.id)).toEqual([b.id]);
  });

  it('updateTask 改字段并推进 updatedAt，返回新行', () => {
    const t = createTask(base);
    const updated = updateTask(t.id, { name: '改名', nextRunAt: 999 });
    expect(updated.name).toBe('改名');
    expect(updated.nextRunAt).toBe(999);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(t.updatedAt);
  });

  it('updateTask 的 enabled 用 boolean 入参、落库为 0/1', () => {
    const t = createTask(base);
    expect(updateTask(t.id, { enabled: false }).enabled).toBe(0);
    expect(updateTask(t.id, { enabled: true }).enabled).toBe(1);
  });

  it('updateTask 不存在抛错', () => {
    expect(() => updateTask('nope', { name: 'x' })).toThrow();
  });

  it('updateTask 对空 patch 不报错、只推 updatedAt', () => {
    const t = createTask(base);
    expect(() => updateTask(t.id, {})).not.toThrow();
  });

  it('scheduleType 换成 once 时 scheduleExpr 置 null，反之亦然', () => {
    const t = createTask(base);
    const u = updateTask(t.id, { scheduleType: 'once', scheduleExpr: null, runAt: 500 });
    expect(u.scheduleType).toBe('once');
    expect(u.scheduleExpr).toBeNull();
    expect(u.runAt).toBe(500);
  });

  it('setTaskSession 更新 session id 与初始化标记', () => {
    const t = createTask(base);
    setTaskSession(t.id, '22222222-2222-4222-8222-222222222222', true);
    const row = getTask(t.id)!;
    expect(row.sessionId).toBe('22222222-2222-4222-8222-222222222222');
    expect(row.sessionInitialized).toBe(1);
  });

  it('touchTaskAfterRun 只写 last_run_at / last_status', () => {
    const t = createTask(base);
    touchTaskAfterRun(t.id, 12345, 'done');
    const row = getTask(t.id)!;
    expect(row.lastRunAt).toBe(12345);
    expect(row.lastStatus).toBe('done');
    expect(row.nextRunAt).toBe(1_700_000_000_000);
  });

  it('deleteTask 删除任务', () => {
    const t = createTask(base);
    deleteTask(t.id);
    expect(getTask(t.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- tests/main/tasks/store.test.ts`
Expected: FAIL — 无法解析 `store.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/tasks/store.ts
// 三表 CRUD 与状态机。只碰 DB，不含调度/执行逻辑。
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';

export type ScheduleType = 'cron' | 'once';
export type RunStatus =
  | 'queued' | 'running' | 'done' | 'error' | 'timeout' | 'skipped' | 'interrupted';

export interface TaskRow {
  id: string;
  name: string;
  enabled: number;
  prompt: string;
  agent: string | null;
  sessionId: string | null;
  sessionInitialized: number;
  scheduleType: ScheduleType;
  scheduleExpr: string | null;
  runAt: number | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  createdAt: number;
  updatedAt: number;
}

export type TaskPatch = Partial<{
  name: string;
  prompt: string;
  enabled: boolean;
  scheduleType: ScheduleType;
  scheduleExpr: string | null;
  runAt: number | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
}>;

export interface CreateTaskInput {
  name: string;
  prompt: string;
  sessionId: string;
  scheduleType: ScheduleType;
  scheduleExpr: string | null;
  runAt: number | null;
  nextRunAt: number | null;
  enabled?: boolean;
  agent?: string;
}

const TASK_COLUMNS = `
  id, name, enabled, prompt, agent, session_id AS sessionId,
  session_initialized AS sessionInitialized,
  schedule_type AS scheduleType, schedule_expr AS scheduleExpr, run_at AS runAt,
  next_run_at AS nextRunAt, last_run_at AS lastRunAt, last_status AS lastStatus,
  created_at AS createdAt, updated_at AS updatedAt
`;

function row(r: unknown): TaskRow | null {
  return (r as TaskRow | undefined) ?? null;
}

export function createTask(input: CreateTaskInput): TaskRow {
  const now = Date.now();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO tasks
       (id,name,enabled,prompt,agent,session_id,session_initialized,
        schedule_type,schedule_expr,run_at,next_run_at,last_run_at,last_status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`,
    )
    .run(
      id,
      input.name,
      input.enabled === false ? 0 : 1,
      input.prompt,
      input.agent ?? 'claude',
      input.sessionId,
      0,
      input.scheduleType,
      input.scheduleExpr,
      input.runAt,
      input.nextRunAt,
      now,
      now,
    );
  return getTask(id)!;
}

export function getTask(id: string): TaskRow | null {
  return row(getDb().prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`).get(id));
}

export function listTasks(opts: { enabledOnly?: boolean } = {}): TaskRow[] {
  const where = opts.enabledOnly ? 'WHERE enabled = 1' : '';
  return getDb()
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks ${where}
       ORDER BY enabled DESC, next_run_at IS NULL, next_run_at ASC, created_at ASC`,
    )
    .all() as unknown as TaskRow[];
}

const PATCH_COLUMN: Record<keyof TaskPatch, string> = {
  name: 'name',
  prompt: 'prompt',
  enabled: 'enabled',
  scheduleType: 'schedule_type',
  scheduleExpr: 'schedule_expr',
  runAt: 'run_at',
  nextRunAt: 'next_run_at',
  lastRunAt: 'last_run_at',
  lastStatus: 'last_status',
};

export function updateTask(id: string, patch: TaskPatch): TaskRow {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(PATCH_COLUMN) as [keyof TaskPatch, string][]) {
    if (!(key in patch)) continue;
    const raw = patch[key];
    sets.push(`${column} = ?`);
    values.push(typeof raw === 'boolean' ? (raw ? 1 : 0) : raw);
  }
  sets.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  const info = getDb()
    .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  if (Number(info.changes) === 0) throw new Error(`task 不存在: ${id}`);
  return getTask(id)!;
}

export function deleteTask(id: string): void {
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function setTaskSession(id: string, sessionId: string, initialized: boolean): void {
  getDb()
    .prepare('UPDATE tasks SET session_id = ?, session_initialized = ?, updated_at = ? WHERE id = ?')
    .run(sessionId, initialized ? 1 : 0, Date.now(), id);
}

export function touchTaskAfterRun(id: string, at: number, status: string): void {
  getDb()
    .prepare('UPDATE tasks SET last_run_at = ?, last_status = ?, updated_at = ? WHERE id = ?')
    .run(at, status, Date.now(), id);
}
```

> **注意** `ON CONFLICT` 与 `info.changes`：`node:sqlite` 的 `run()` 返回 `{ changes, lastInsertRowid }`，`changes` 是 `number | bigint`，所以上面用 `Number(info.changes)`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- tests/main/tasks/store.test.ts`
Expected: PASS（12 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/main/tasks/store.ts tests/main/tasks/store.test.ts
git commit -m "feat: 新增定时任务表 CRUD"
```

---

## Task 4: 运行表与事件表 + 启动恢复（`store.ts` 第二部分）

**Files:**
- Modify: `src/main/tasks/store.ts`（追加）
- Modify: `tests/main/tasks/store.test.ts`（追加 describe 块）

**Interfaces:**
- Produces:
  - `RunRow` / `RawEventRow` / `FinishRunPatch`
  - `createRun(taskId: string, trigger: 'scheduled' | 'manual'): RunRow`
  - `getRun(id: string): RunRow | null`
  - `listRuns(taskId: string, opts: { limit: number; before?: number }): RunRow[]`
  - `listLiveRuns(): RunRow[]`（`queued` / `running`）
  - `markRunRunning(id: string): void`
  - `finishRun(id: string, status: RunStatus, patch?: FinishRunPatch): void`
  - `appendEvent(runId: string, seq: number, type: string, subtype: string | null, payload: string): void`
  - `listEventsRaw(runId: string, afterSeq = -1): RawEventRow[]`
  - `recoverStaleRuns(): { interrupted: RunRow[]; requeued: RunRow[] }`

- [ ] **Step 1: Write the failing test（追加到 `store.test.ts`）**

```ts
// 追加到 tests/main/tasks/store.test.ts
import {
  createRun, getRun, listRuns, listLiveRuns, markRunRunning,
  finishRun, appendEvent, listEventsRaw, recoverStaleRuns,
} from '../../../src/main/tasks/store.js';

describe('runs 与 run_events', () => {
  it('createRun 建 queued run，trigger 正确落库', () => {
    const t = createTask(base);
    const r = createRun(t.id, 'scheduled');
    expect(r.status).toBe('queued');
    expect(r.trigger).toBe('scheduled');
    expect(r.queuedAt).toBeGreaterThan(0);
    expect(r.startedAt).toBeNull();
    expect(r.eventCount).toBe(0);
  });

  it('markRunRunning 写 started_at 并切状态', () => {
    const t = createTask(base);
    const r = createRun(t.id, 'manual');
    markRunRunning(r.id);
    const got = getRun(r.id)!;
    expect(got.status).toBe('running');
    expect(got.startedAt).toBeGreaterThan(0);
  });

  it('finishRun 写终态与 result 字段', () => {
    const t = createTask(base);
    const r = createRun(t.id, 'scheduled');
    markRunRunning(r.id);
    finishRun(r.id, 'done', {
      resultSubtype: 'success',
      resultText: '搞定了',
      numTurns: 3,
      durationMs: 1200,
      totalCostUsd: 0.0123,
      usageJson: '{"input_tokens":10}',
      exitCode: 0,
      isError: 0,
    });
    const got = getRun(r.id)!;
    expect(got.status).toBe('done');
    expect(got.finishedAt).toBeGreaterThan(0);
    expect(got.resultText).toBe('搞定了');
    expect(got.numTurns).toBe(3);
    expect(got.totalCostUsd).toBeCloseTo(0.0123);
  });

  it('listRuns 按 queued_at 倒序分页，before 做游标', () => {
    const t = createTask(base);
    const r1 = createRun(t.id, 'scheduled');
    const r2 = createRun(t.id, 'scheduled');
    const r3 = createRun(t.id, 'scheduled');
    const page1 = listRuns(t.id, { limit: 2 });
    expect(page1.map((r) => r.id)).toEqual([r3.id, r2.id]);
    const page2 = listRuns(t.id, { limit: 2, before: page1[1].queuedAt });
    expect(page2.map((r) => r.id)).toEqual([r1.id]);
  });

  it('listRuns 只返回该任务的 run', () => {
    const t1 = createTask(base);
    const t2 = createTask({ ...base, name: '另一个' });
    createRun(t1.id, 'scheduled');
    createRun(t2.id, 'scheduled');
    expect(listRuns(t1.id, { limit: 10 })).toHaveLength(1);
  });

  it('appendEvent 逐行落库并可增量读取', () => {
    const t = createTask(base);
    const r = createRun(t.id, 'scheduled');
    appendEvent(r.id, 0, 'system', 'init', '{"a":1}');
    appendEvent(r.id, 1, 'assistant', null, '{"b":2}');
    const all = listEventsRaw(r.id);
    expect(all.map((e) => e.seq)).toEqual([0, 1]);
    expect(all[0].payload).toBe('{"a":1}');
    expect(listEventsRaw(r.id, 0).map((e) => e.seq)).toEqual([1]);
    expect(listEventsRaw(r.id, 1)).toHaveLength(0);
  });

  it('appendEvent 同步递增 runs.event_count', () => {
    const t = createTask(base);
    const r = createRun(t.id, 'scheduled');
    appendEvent(r.id, 0, 'stderr', null, 'x');
    appendEvent(r.id, 1, 'stderr', null, 'y');
    expect(getRun(r.id)!.eventCount).toBe(2);
  });

  it('listLiveRuns 只返回非终态', () => {
    const t = createTask(base);
    const a = createRun(t.id, 'scheduled');
    const b = createRun(t.id, 'scheduled');
    const c = createRun(t.id, 'scheduled');
    markRunRunning(a.id);
    finishRun(b.id, 'done');
    expect(listLiveRuns().map((r) => r.id).sort()).toEqual([a.id, c.id].sort());
  });

  it('recoverStaleRuns: running 标 interrupted，queued 原样返回待重新入队', () => {
    const t = createTask(base);
    const a = createRun(t.id, 'scheduled');
    const b = createRun(t.id, 'scheduled');
    markRunRunning(a.id);
    const res = recoverStaleRuns();
    expect(res.interrupted.map((r) => r.id)).toEqual([a.id]);
    expect(res.requeued.map((r) => r.id)).toEqual([b.id]);
    expect(getRun(a.id)!.status).toBe('interrupted');
    expect(getRun(a.id)!.error).toBe('App 退出时仍在运行');
    expect(getRun(b.id)!.status).toBe('queued');
  });

  it('recoverStaleRuns 不动终态 run', () => {
    const t = createTask(base);
    const a = createRun(t.id, 'scheduled');
    finishRun(a.id, 'done');
    const res = recoverStaleRuns();
    expect(res.interrupted).toHaveLength(0);
    expect(res.requeued).toHaveLength(0);
    expect(getRun(a.id)!.status).toBe('done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- tests/main/tasks/store.test.ts`
Expected: FAIL — `createRun is not a function`

- [ ] **Step 3: Write minimal implementation（追加到 `store.ts`）**

```ts
// ===== 追加到 src/main/tasks/store.ts =====

export interface RunRow {
  id: string;
  taskId: string;
  trigger: string;
  status: RunStatus;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  sessionId: string | null;
  resumeUsed: number | null;
  exitCode: number | null;
  isError: number | null;
  resultSubtype: string | null;
  resultText: string | null;
  numTurns: number | null;
  durationMs: number | null;
  totalCostUsd: number | null;
  usageJson: string | null;
  error: string | null;
  eventCount: number;
}

export interface RawEventRow {
  runId: string;
  seq: number;
  ts: number;
  type: string;
  subtype: string | null;
  payload: string;
}

export interface FinishRunPatch {
  sessionId?: string | null;
  resumeUsed?: number | null;
  exitCode?: number | null;
  isError?: number | null;
  resultSubtype?: string | null;
  resultText?: string | null;
  numTurns?: number | null;
  durationMs?: number | null;
  totalCostUsd?: number | null;
  usageJson?: string | null;
  error?: string | null;
}

const RUN_COLUMNS = `
  id, task_id AS taskId, trigger, status, queued_at AS queuedAt,
  started_at AS startedAt, finished_at AS finishedAt, session_id AS sessionId,
  resume_used AS resumeUsed, exit_code AS exitCode, is_error AS isError,
  result_subtype AS resultSubtype, result_text AS resultText, num_turns AS numTurns,
  duration_ms AS durationMs, total_cost_usd AS totalCostUsd, usage_json AS usageJson,
  error, event_count AS eventCount
`;

const LIVE_STATUSES = `('queued','running')`;

export function createRun(taskId: string, trigger: 'scheduled' | 'manual'): RunRow {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare('INSERT INTO runs(id, task_id, trigger, status, queued_at, event_count) VALUES(?,?,?,?,?,0)')
    .run(id, taskId, trigger, 'queued', now);
  return getRun(id)!;
}

export function getRun(id: string): RunRow | null {
  return row(getDb().prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`).get(id)) as RunRow | null;
}

export function listRuns(taskId: string, opts: { limit: number; before?: number }): RunRow[] {
  const before = opts.before;
  const sql = before
    ? `SELECT ${RUN_COLUMNS} FROM runs WHERE task_id = ? AND queued_at < ? ORDER BY queued_at DESC LIMIT ?`
    : `SELECT ${RUN_COLUMNS} FROM runs WHERE task_id = ? ORDER BY queued_at DESC LIMIT ?`;
  const args = before ? [taskId, before, opts.limit] : [taskId, opts.limit];
  return getDb().prepare(sql).all(...(args as never[])) as unknown as RunRow[];
}

export function listLiveRuns(): RunRow[] {
  return getDb()
    .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE status IN ${LIVE_STATUSES} ORDER BY queued_at ASC`)
    .all() as unknown as RunRow[];
}

export function markRunRunning(id: string): void {
  getDb().prepare('UPDATE runs SET status = ?, started_at = ? WHERE id = ?').run('running', Date.now(), id);
}

const FINISH_COLUMN: Record<keyof FinishRunPatch, string> = {
  sessionId: 'session_id', resumeUsed: 'resume_used', exitCode: 'exit_code',
  isError: 'is_error', resultSubtype: 'result_subtype', resultText: 'result_text',
  numTurns: 'num_turns', durationMs: 'duration_ms', totalCostUsd: 'total_cost_usd',
  usageJson: 'usage_json', error: 'error',
};

export function finishRun(id: string, status: RunStatus, patch: FinishRunPatch = {}): void {
  const sets = ['status = ?', 'finished_at = ?'];
  const values: unknown[] = [status, Date.now()];
  for (const [key, column] of Object.entries(FINISH_COLUMN) as [keyof FinishRunPatch, string][]) {
    if (!(key in patch)) continue;
    sets.push(`${column} = ?`);
    values.push(patch[key] ?? null);
  }
  values.push(id);
  getDb().prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...(values as never[]));
}

export function appendEvent(
  runId: string,
  seq: number,
  type: string,
  subtype: string | null,
  payload: string,
): void {
  const db = getDb();
  db.prepare('INSERT INTO run_events(run_id,seq,ts,type,subtype,payload) VALUES(?,?,?,?,?,?)').run(
    runId, seq, Date.now(), type, subtype, payload,
  );
  db.prepare('UPDATE runs SET event_count = event_count + 1 WHERE id = ?').run(runId);
}

export function listEventsRaw(runId: string, afterSeq = -1): RawEventRow[] {
  return getDb()
    .prepare(
      `SELECT run_id AS runId, seq, ts, type, subtype, payload
       FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC`,
    )
    .all(runId, afterSeq) as unknown as RawEventRow[];
}

/** 启动时调用一次：running 的 run 无进程可救 → 标 interrupted；
 *  queued 的 run 尚未启动 → 原样返回，由 scheduler 重新入队（不能凭空丢弃）。 */
export function recoverStaleRuns(): { interrupted: RunRow[]; requeued: RunRow[] } {
  const db = getDb();
  const running = db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE status = 'running'`).all() as unknown as RunRow[];
  for (const r of running) {
    db.prepare('UPDATE runs SET status = ?, finished_at = ?, error = ? WHERE id = ?').run(
      'interrupted', Date.now(), 'App 退出时仍在运行', r.id,
    );
  }
  const requeued = db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE status = 'queued' ORDER BY queued_at ASC`).all() as unknown as RunRow[];
  return { interrupted: running, requeued };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- tests/main/tasks/store.test.ts`
Expected: PASS（22 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/main/tasks/store.ts tests/main/tasks/store.test.ts
git commit -m "feat: 新增运行记录与事件表存储及启动恢复"
```

---

## Task 5: cron 与预设互转 + 下次运行时间（`schedule.ts` 第一部分）

**Files:**
- Create: `src/main/tasks/schedule.ts`
- Test: `tests/main/tasks/schedule.test.ts`
- Modify: `package.json`（新增 `croner` 依赖）

**Interfaces:**
- Produces:
  - `PresetKind` / `Preset` / `Schedule`
  - `presetToCron(p: Preset): string`
  - `cronToPreset(expression: string): Preset`
  - `computeNextRun(s: Schedule, from: number): number | null`
  - `describeSchedule(s: Schedule): string`

- [ ] **Step 1: 安装依赖**

```bash
npm install croner@^10
```
Expected：`package.json` 的 `dependencies` 出现 `"croner": "^10.x.x"`。

- [ ] **Step 2: Write the failing test**

```ts
// tests/main/tasks/schedule.test.ts
import { describe, it, expect } from 'vitest';
import {
  presetToCron, cronToPreset, computeNextRun, describeSchedule,
  type Preset,
} from '../../../src/main/tasks/schedule.js';

describe('presetToCron', () => {
  it('每天 → M H * * *', () => {
    expect(presetToCron({ kind: 'daily', hour: 9, minute: 0 })).toBe('0 9 * * *');
    expect(presetToCron({ kind: 'daily', hour: 0, minute: 30 })).toBe('30 0 * * *');
  });

  it('每周 → M H * * 排序后的星期列表', () => {
    expect(presetToCron({ kind: 'weekly', hour: 17, minute: 0, weekdays: [5] })).toBe('0 17 * * 5');
    expect(presetToCron({ kind: 'weekly', hour: 9, minute: 30, weekdays: [5, 1, 3] })).toBe('30 9 * * 1,3,5');
    expect(presetToCron({ kind: 'weekly', hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5] })).toBe('0 9 * * 1,2,3,4,5');
  });

  it('每月 → M H D * *', () => {
    expect(presetToCron({ kind: 'monthly', hour: 10, minute: 0, dayOfMonth: 1 })).toBe('0 10 1 * *');
    expect(presetToCron({ kind: 'monthly', hour: 23, minute: 59, dayOfMonth: 31 })).toBe('59 23 31 * *');
  });

  it('每小时 → M * * * *', () => {
    expect(presetToCron({ kind: 'hourly', minute: 5 })).toBe('5 * * * *');
  });

  it('每 N 分钟 → */N * * * *', () => {
    expect(presetToCron({ kind: 'everyNMinutes', everyMinutes: 15 })).toBe('*/15 * * * *');
    expect(presetToCron({ kind: 'everyNMinutes', everyMinutes: 1 })).toBe('*/1 * * * *');
  });

  it('自定义直接返回表达式', () => {
    expect(presetToCron({ kind: 'custom', expression: '0 0 1 1 *' })).toBe('0 0 1 1 *');
  });

  it('参数越界抛错（表单层要拦，但纯函数也要守住）', () => {
    expect(() => presetToCron({ kind: 'daily', hour: 24, minute: 0 })).toThrow();
    expect(() => presetToCron({ kind: 'daily', hour: 9, minute: 60 })).toThrow();
    expect(() => presetToCron({ kind: 'weekly', hour: 9, minute: 0, weekdays: [] })).toThrow();
    expect(() => presetToCron({ kind: 'weekly', hour: 9, minute: 0, weekdays: [7] })).toThrow();
    expect(() => presetToCron({ kind: 'monthly', hour: 9, minute: 0, dayOfMonth: 0 })).toThrow();
    expect(() => presetToCron({ kind: 'monthly', hour: 9, minute: 0, dayOfMonth: 32 })).toThrow();
    expect(() => presetToCron({ kind: 'everyNMinutes', everyMinutes: 0 })).toThrow();
    expect(() => presetToCron({ kind: 'everyNMinutes', everyMinutes: 60 })).toThrow();
    expect(() => presetToCron({ kind: 'custom', expression: '  ' })).toThrow();
  });
});

describe('cronToPreset', () => {
  it('认识的模板精确反查回预设', () => {
    expect(cronToPreset('0 9 * * *')).toEqual({ kind: 'daily', hour: 9, minute: 0 });
    expect(cronToPreset('30 9 * * 1,3,5')).toEqual({ kind: 'weekly', hour: 9, minute: 30, weekdays: [1, 3, 5] });
    expect(cronToPreset('0 10 1 * *')).toEqual({ kind: 'monthly', hour: 10, minute: 0, dayOfMonth: 1 });
    expect(cronToPreset('5 * * * *')).toEqual({ kind: 'hourly', minute: 5 });
    expect(cronToPreset('*/15 * * * *')).toEqual({ kind: 'everyNMinutes', everyMinutes: 15 });
  });

  it('不认识的一律落 custom 并带回原表达式', () => {
    expect(cronToPreset('0 0 1 1 *')).toEqual({ kind: 'custom', expression: '0 0 1 1 *' });
    expect(cronToPreset('0 9 * * 1-5')).toEqual({ kind: 'custom', expression: '0 9 * * 1-5' });
    expect(cronToPreset('0 9 1,15 * *')).toEqual({ kind: 'custom', expression: '0 9 1,15 * *' });
  });

  it('表达式两端的空白被归一化后再匹配', () => {
    expect(cronToPreset('  0 9 * * *  ')).toEqual({ kind: 'daily', hour: 9, minute: 0 });
  });
});

describe('预设 ↔ cron 往返（覆盖全部模板）', () => {
  const cases: Preset[] = [
    { kind: 'daily', hour: 9, minute: 0 },
    { kind: 'daily', hour: 0, minute: 0 },
    { kind: 'daily', hour: 23, minute: 59 },
    { kind: 'weekly', hour: 17, minute: 0, weekdays: [5] },
    { kind: 'weekly', hour: 9, minute: 30, weekdays: [1, 3, 5] },
    { kind: 'weekly', hour: 8, minute: 0, weekdays: [0, 6] },
    { kind: 'weekly', hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5] },
    { kind: 'monthly', hour: 10, minute: 0, dayOfMonth: 1 },
    { kind: 'monthly', hour: 23, minute: 59, dayOfMonth: 31 },
    { kind: 'monthly', hour: 0, minute: 0, dayOfMonth: 15 },
    { kind: 'hourly', minute: 0 },
    { kind: 'hourly', minute: 45 },
    { kind: 'everyNMinutes', everyMinutes: 1 },
    { kind: 'everyNMinutes', everyMinutes: 5 },
    { kind: 'everyNMinutes', everyMinutes: 59 },
  ];

  it.each(cases)('cronToPreset(presetToCron($kind)) 回到原预设', (preset) => {
    expect(cronToPreset(presetToCron(preset))).toEqual(preset);
  });

  it('所有生成的表达式都是 croner 认可的合法表达式', async () => {
    const { Cron } = await import('croner');
    for (const preset of cases) {
      const expr = presetToCron(preset);
      expect(() => new Cron(expr), `非法表达式: ${expr}`).not.toThrow();
    }
  });
});

describe('computeNextRun', () => {
  it('cron：从给定时刻往后算下一次', () => {
    const from = new Date('2026-09-18T08:00:00').getTime();
    const next = computeNextRun({ type: 'cron', expression: '0 9 * * *' }, from)!;
    expect(new Date(next).getHours()).toBe(9);
    expect(new Date(next).getDate()).toBe(18);
  });

  it('cron：当天已过则顺延到明天', () => {
    const from = new Date('2026-09-18T10:00:00').getTime();
    const next = computeNextRun({ type: 'cron', expression: '0 9 * * *' }, from)!;
    expect(new Date(next).getDate()).toBe(19);
    expect(new Date(next).getHours()).toBe(9);
  });

  it('once：未来时间返回该时间戳', () => {
    const from = 1000;
    expect(computeNextRun({ type: 'once', runAt: 5000 }, from)).toBe(5000);
  });

  it('once：已过去返回 null', () => {
    expect(computeNextRun({ type: 'once', runAt: 100 }, 5000)).toBeNull();
  });

  it('非法 cron 表达式返回 null，不抛异常', () => {
    expect(computeNextRun({ type: 'cron', expression: 'not a cron' }, Date.now())).toBeNull();
    expect(computeNextRun({ type: 'cron', expression: '' }, Date.now())).toBeNull();
  });
});

describe('describeSchedule', () => {
  it('生成人类可读摘要', () => {
    expect(describeSchedule({ type: 'cron', expression: '0 9 * * *' })).toBe('每天 09:00');
    expect(describeSchedule({ type: 'cron', expression: '30 9 * * 1,3,5' })).toBe('每周一、三、五 09:30');
    expect(describeSchedule({ type: 'cron', expression: '0 10 1 * *' })).toBe('每月 1 号 10:00');
    expect(describeSchedule({ type: 'cron', expression: '5 * * * *' })).toBe('每小时第 5 分钟');
    expect(describeSchedule({ type: 'cron', expression: '*/15 * * * *' })).toBe('每 15 分钟');
  });

  it('自定义表达式回显表达式本身', () => {
    expect(describeSchedule({ type: 'cron', expression: '0 0 1 1 *' })).toBe('0 0 1 1 *');
  });

  it('once 显示具体时间', () => {
    const at = new Date('2026-09-20T14:30:00').getTime();
    expect(describeSchedule({ type: 'once', runAt: at })).toContain('09-20');
    expect(describeSchedule({ type: 'once', runAt: at })).toContain('14:30');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:main -- tests/main/tasks/schedule.test.ts`
Expected: FAIL — 无法解析 `schedule.js`

- [ ] **Step 4: Write minimal implementation**

```ts
// src/main/tasks/schedule.ts
// 纯函数：调度计算。不碰 DB、不碰时钟（时间一律由调用方传入）。
import { Cron } from 'croner';

export type Schedule = { type: 'cron'; expression: string } | { type: 'once'; runAt: number };

export type PresetKind =
  | 'daily' | 'weekly' | 'monthly' | 'hourly' | 'everyNMinutes' | 'once' | 'custom';

export interface Preset {
  kind: PresetKind;
  hour?: number;        // 0-23
  minute?: number;      // 0-59
  weekdays?: number[];  // 0-6，0 = 周日（cron 约定）
  dayOfMonth?: number;  // 1-31
  everyMinutes?: number; // 1-59
  runAt?: number;       // once
  expression?: string;  // custom
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

function assertInt(v: unknown, min: number, max: number, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${label} 必须是 ${min}-${max} 的整数，收到 ${String(v)}`);
  }
  return v;
}

function hhmm(hour: number, minute: number): { h: number; m: number } {
  return { h: assertInt(hour, 0, 23, '小时'), m: assertInt(minute, 0, 59, '分钟') };
}

export function presetToCron(p: Preset): string {
  switch (p.kind) {
    case 'daily': {
      const { h, m } = hhmm(p.hour!, p.minute!);
      return `${m} ${h} * * *`;
    }
    case 'weekly': {
      const { h, m } = hhmm(p.hour!, p.minute!);
      const days = p.weekdays ?? [];
      if (days.length === 0) throw new Error('每周至少要选一天');
      for (const d of days) assertInt(d, 0, 6, '星期');
      const sorted = [...new Set(days)].sort((a, b) => a - b);
      return `${m} ${h} * * ${sorted.join(',')}`;
    }
    case 'monthly': {
      const { h, m } = hhmm(p.hour!, p.minute!);
      const d = assertInt(p.dayOfMonth, 1, 31, '几号');
      return `${m} ${h} ${d} * *`;
    }
    case 'hourly': {
      const m = assertInt(p.minute, 0, 59, '分钟');
      return `${m} * * * *`;
    }
    case 'everyNMinutes': {
      const n = assertInt(p.everyMinutes, 1, 59, '间隔分钟');
      return `*/${n} * * * *`;
    }
    case 'custom': {
      const expr = (p.expression ?? '').trim();
      if (!expr) throw new Error('自定义 cron 表达式不能为空');
      return expr;
    }
    case 'once':
      throw new Error('一次性任务不走 cron，请用 schedule_type=once + run_at');
    default:
      throw new Error(`未知预设类型: ${String(p.kind)}`);
  }
}

export function cronToPreset(expression: string): Preset {
  const expr = (expression ?? '').trim();
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return { kind: 'custom', expression: expr };
  const [mi, ho, dom, mon, dow] = parts;

  const num = (s: string, max: number): number | null => {
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return n >= 0 && n <= max ? n : null;
  };

  // */N * * * *
  if (mi.startsWith('*/') && ho === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = num(mi.slice(2), 59);
    if (n !== null && n >= 1) return { kind: 'everyNMinutes', everyMinutes: n };
  }
  // M * * * *
  const mOnly = num(mi, 59);
  if (mOnly !== null && ho === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { kind: 'hourly', minute: mOnly };
  }
  const m = num(mi, 59);
  const h = num(ho, 23);
  if (m === null || h === null) return { kind: 'custom', expression: expr };

  // M H D * *
  if (dom !== '*' && mon === '*' && dow === '*') {
    const d = num(dom, 31);
    if (d !== null && d >= 1) return { kind: 'monthly', hour: h, minute: m, dayOfMonth: d };
    return { kind: 'custom', expression: expr };
  }
  // M H * * D[,D...]
  if (dom === '*' && mon === '*' && dow !== '*') {
    const items = dow.split(',');
    const days: number[] = [];
    for (const it of items) {
      const d = num(it, 6);
      if (d === null) return { kind: 'custom', expression: expr };
      days.push(d);
    }
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    if (sorted.length !== days.length) return { kind: 'custom', expression: expr };
    return { kind: 'weekly', hour: h, minute: m, weekdays: sorted };
  }
  // M H * * *
  if (dom === '*' && mon === '*' && dow === '*') {
    return { kind: 'daily', hour: h, minute: m };
  }
  return { kind: 'custom', expression: expr };
}

export function computeNextRun(s: Schedule, from: number): number | null {
  if (s.type === 'once') return s.runAt > from ? s.runAt : null;
  const expr = (s.expression ?? '').trim();
  if (!expr) return null;
  try {
    const next = new Cron(expr).nextRun(new Date(from));
    return next ? next.getTime() : null;
  } catch {
    return null;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function describeSchedule(s: Schedule): string {
  if (s.type === 'once') {
    const d = new Date(s.runAt);
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  const preset = cronToPreset(s.expression);
  switch (preset.kind) {
    case 'daily':
      return `每天 ${pad2(preset.hour!)}:${pad2(preset.minute!)}`;
    case 'weekly':
      return `每周${preset.weekdays!.map((d) => WEEKDAY_CN[d]).join('、')} ${pad2(preset.hour!)}:${pad2(preset.minute!)}`;
    case 'monthly':
      return `每月 ${preset.dayOfMonth} 号 ${pad2(preset.hour!)}:${pad2(preset.minute!)}`;
    case 'hourly':
      return `每小时第 ${preset.minute} 分钟`;
    case 'everyNMinutes':
      return `每 ${preset.everyMinutes} 分钟`;
    default:
      return (s.expression ?? '').trim();
  }
}
```

> `croner` 的 `nextRun` 返回带本地时区语义的 `Date`；`getTime()` 得到 epoch ms。所有比较用 epoch ms，不做 naive/aware 之争。

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:main -- tests/main/tasks/schedule.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/tasks/schedule.ts tests/main/tasks/schedule.test.ts
git commit -m "feat: 新增调度预设与下次运行时间计算"
```

---

## Task 6: 到期判定与补跑窗口（`schedule.ts` 第二部分）

**Files:**
- Modify: `src/main/tasks/schedule.ts`（追加）
- Modify: `tests/main/tasks/schedule.test.ts`（追加 describe 块）

**Interfaces:**
- Produces:
  - `DueState = 'not_due' | 'due' | 'missed'`
  - `isDue(nextRunAt: number | null, now: number, catchUpMs: number): DueState`
  - `CATCH_UP_MS` / `QUEUE_TIMEOUT_MS` / `RUN_TIMEOUT_MS`

- [ ] **Step 1: Write the failing test（追加到 `schedule.test.ts`）**

```ts
// 追加到 tests/main/tasks/schedule.test.ts
import { isDue, CATCH_UP_MS, QUEUE_TIMEOUT_MS, RUN_TIMEOUT_MS } from '../../../src/main/tasks/schedule.js';

describe('常量', () => {
  it('补跑窗口 60 分钟、排队上限 30 分钟、单次超时 30 分钟', () => {
    expect(CATCH_UP_MS).toBe(60 * 60 * 1000);
    expect(QUEUE_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(RUN_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});

describe('isDue', () => {
  const now = 10_000_000;

  it('nextRunAt 为空 → not_due（调用方负责计算并落库，不触发）', () => {
    expect(isDue(null, now, CATCH_UP_MS)).toBe('not_due');
  });

  it('还没到点 → not_due', () => {
    expect(isDue(now + 1, now, CATCH_UP_MS)).toBe('not_due');
  });

  it('正好到点 → due', () => {
    expect(isDue(now, now, CATCH_UP_MS)).toBe('due');
  });

  it('窗口边界：59m59s 前到期 → due', () => {
    expect(isDue(now - (CATCH_UP_MS - 1000), now, CATCH_UP_MS)).toBe('due');
  });

  it('窗口边界：正好 60m0s 前到期 → due（闭区间）', () => {
    expect(isDue(now - CATCH_UP_MS, now, CATCH_UP_MS)).toBe('due');
  });

  it('窗口边界：60m0s+1ms 前到期 → missed', () => {
    expect(isDue(now - CATCH_UP_MS - 1, now, CATCH_UP_MS)).toBe('missed');
  });

  it('关了一整夜（10 小时前）→ missed', () => {
    expect(isDue(now - 10 * 60 * 60 * 1000, now, CATCH_UP_MS)).toBe('missed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- tests/main/tasks/schedule.test.ts`
Expected: FAIL — `isDue is not a function`

- [ ] **Step 3: Write minimal implementation（追加到 `schedule.ts`）**

```ts
// ===== 追加到 src/main/tasks/schedule.ts =====

/** 错过的任务在窗口内仍然补跑；超过窗口就跳过、直接排下一次。
 *  桌面应用关一整夜是常态，60 分钟比 cowagent 的 10 分钟宽。 */
export const CATCH_UP_MS = 60 * 60 * 1000;

/** 入队后超过这个时长仍未启动 → 标 skipped，避免「每天 9:00 的日报」拖到 11:00 才发。 */
export const QUEUE_TIMEOUT_MS = 30 * 60 * 1000;

/** 单次 run 的墙钟上限，到点 SIGTERM → 5s → SIGKILL。 */
export const RUN_TIMEOUT_MS = 30 * 60 * 1000;

export type DueState = 'not_due' | 'due' | 'missed';

export function isDue(nextRunAt: number | null, now: number, catchUpMs: number): DueState {
  if (nextRunAt == null) return 'not_due';
  if (now < nextRunAt) return 'not_due';
  return now - nextRunAt <= catchUpMs ? 'due' : 'missed';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- tests/main/tasks/schedule.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/tasks/schedule.ts tests/main/tasks/schedule.test.ts
git commit -m "feat: 新增任务到期判定与补跑窗口"
```

---

## Task 7: stream-json 行解析（`streamParse.ts`）

**Files:**
- Create: `src/main/tasks/streamParse.ts`
- Test: `tests/main/tasks/streamParse.test.ts`

**Interfaces:**
- Produces:
  - `NormalizedBlock` / `NormalizedEvent` / `ResultSummary` / `InitInfo`
  - `USAGE_KEYS: readonly string[]`
  - `normalizeToolResultContent(content: unknown): string`
  - `pickUsage(raw: unknown): Record<string, number>`
  - `parseStreamLine(line: string): NormalizedEvent | null`
  - `parseStreamText(text: string): NormalizedEvent[]`（按行切分 + 跳过无效行，给测试和 runner 共用）
  - `isResumeMissing(events: NormalizedEvent[]): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/tasks/streamParse.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseStreamLine, parseStreamText, normalizeToolResultContent, pickUsage,
  isResumeMissing, USAGE_KEYS, type NormalizedEvent,
} from '../../../src/main/tasks/streamParse.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'stream-sample.jsonl');
const fixtureLines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);

describe('parseStreamLine 基本健壮性', () => {
  it('空行 / 纯空白 → null', () => {
    expect(parseStreamLine('')).toBeNull();
    expect(parseStreamLine('   ')).toBeNull();
    expect(parseStreamLine('\r')).toBeNull();
  });

  it('非法 JSON → null（不抛异常）', () => {
    expect(parseStreamLine('not json at all')).toBeNull();
    expect(parseStreamLine('{ broken')).toBeNull();
  });

  it('合法 JSON 但缺 type → null', () => {
    expect(parseStreamLine('{"a":1}')).toBeNull();
    expect(parseStreamLine('[]')).toBeNull();
    expect(parseStreamLine('null')).toBeNull();
  });

  it('未知 type → null（未知事件不再往下传）', () => {
    expect(parseStreamLine('{"type":"tool_progress","tool_name":"Bash"}')).toBeNull();
    expect(parseStreamLine('{"type":"control_request"}')).toBeNull();
  });

  it('带 \\r\\n 的行走同样的路径', () => {
    const ev = parseStreamLine('{"type":"stderr","text":"boom"}\r');
    expect(ev?.type).toBe('stderr');
    expect(ev?.text).toBe('boom');
  });

  it('超长行不炸', () => {
    const big = 'x'.repeat(2_000_000);
    const ev = parseStreamLine(JSON.stringify({ type: 'stderr', text: big }));
    expect(ev?.text?.length).toBe(2_000_000);
  });
});

describe('system 事件（C4：hook_started / hook_response 不能被丢）', () => {
  it('init 抽出 cwd/model/tools 数量/mcp 失败列表', () => {
    const ev = parseStreamLine(fixtureLines[2])!;
    expect(ev.type).toBe('system');
    expect(ev.subtype).toBe('init');
    expect(ev.init?.model).toBeTruthy();
    expect(ev.init?.toolCount).toBeGreaterThan(0);
    expect(ev.init?.cwd).toBeTruthy();
  });

  it('init 里 mcp_servers 的 failed 项被抽出来', () => {
    const ev = parseStreamLine(fixtureLines[2])!;
    expect(ev.init?.failedMcpServers).toContain('tma1');
  });

  it('hook_started 归一化为 hook 事件且带名字', () => {
    const ev = parseStreamLine(fixtureLines[0])!;
    expect(ev.type).toBe('system');
    expect(ev.subtype).toBe('hook_started');
    expect(ev.hook?.name).toContain('SessionStart');
  });

  it('hook_response 带成功标记', () => {
    const ev = parseStreamLine(fixtureLines[1])!;
    expect(ev.subtype).toBe('hook_response');
    expect(ev.hook?.ok).toBe(true);
  });

  it('hook_response 的 outcome 非 success 时 ok=false', () => {
    const raw = JSON.stringify({
      type: 'system', subtype: 'hook_response', hook_name: 'PostToolUse:Bash',
      hook_event: 'PostToolUse', exit_code: 2, outcome: 'error',
    });
    expect(parseStreamLine(raw)!.hook?.ok).toBe(false);
  });
});

describe('assistant 事件（C1：一个 block 一行，messageId 必须透出）', () => {
  it('thinking block 归一化，空 thinking 被过滤成空 blocks', () => {
    const ev = parseStreamLine(fixtureLines[3])!;
    expect(ev.type).toBe('assistant');
    expect(ev.messageId).toBeTruthy();
    expect(ev.blocks?.[0].type).toBe('thinking');
  });

  it('空的 thinking block（thinking 为空串）不产出 block', () => {
    const ev = parseStreamLine(fixtureLines[6])!;
    expect(ev.type).toBe('assistant');
    expect(ev.blocks).toEqual([]);
  });

  it('tool_use block 保留原始 id 与 name 与 input（C2：id 不带 toolu_ 前缀）', () => {
    const ev = parseStreamLine(fixtureLines[4])!;
    const block = ev.blocks!.find((b) => b.type === 'tool_use')!;
    expect(block.type).toBe('tool_use');
    if (block.type !== 'tool_use') throw new Error('unreachable');
    expect(block.id).not.toMatch(/^toolu_/);
    expect(block.id).toContain('call_');
    expect(block.name).toBe('Bash');
    expect(block.input.command).toBe('ls -la');
  });

  it('同一 message.id 跨多行的行都带同一个 messageId', () => {
    const a = parseStreamLine(fixtureLines[3])!;
    const b = parseStreamLine(fixtureLines[4])!;
    expect(a.messageId).toBe(b.messageId);
    const c = parseStreamLine(fixtureLines[6])!;
    expect(c.messageId).not.toBe(a.messageId);
  });

  it('content 是字符串（legacy）时当成单个 text block', () => {
    const raw = JSON.stringify({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: 'hi' } });
    expect(parseStreamLine(raw)!.blocks).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('parent_tool_use_id 透出（子代理）', () => {
    const raw = JSON.stringify({
      type: 'assistant', parent_tool_use_id: 'call_x',
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'sub' }] },
    });
    expect(parseStreamLine(raw)!.parentToolUseId).toBe('call_x');
    const top = parseStreamLine(fixtureLines[3])!;
    expect(top.parentToolUseId).toBeNull();
  });
});

describe('user 事件与 tool_result（C3：content 多态）', () => {
  it('字符串 content 直接沿用', () => {
    const ev = parseStreamLine(fixtureLines[5])!;
    expect(ev.type).toBe('user');
    expect(ev.toolResult?.isError).toBe(false);
    expect(ev.toolResult?.content).toContain('total');
    expect(ev.toolResult?.toolUseId).toContain('call_');
  });

  it('数组 content 拼接 text block', () => {
    const raw = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }] },
    });
    expect(parseStreamLine(raw)!.toolResult?.content).toBe('a\nb');
  });

  it('content 为 null 时归一化成空串，不抛', () => {
    const raw = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: null }] },
    });
    expect(parseStreamLine(raw)!.toolResult?.content).toBe('');
  });

  it('image block 降级为占位文字', () => {
    const raw = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'image', source: {} }, { type: 'text', text: 'ok' }] }] },
    });
    expect(parseStreamLine(raw)!.toolResult?.content).toBe('[图片]\nok');
  });

  it('is_error 缺失按 false；is_error 为 true 时透出', () => {
    const base = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'e' }] } };
    expect(parseStreamLine(JSON.stringify(base))!.toolResult?.isError).toBe(false);
    const err = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'e', is_error: true }] } };
    expect(parseStreamLine(JSON.stringify(err))!.toolResult?.isError).toBe(true);
  });

  it('纯文本 user 消息（没有 tool_result）不产出 toolResult', () => {
    const raw = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } });
    const ev = parseStreamLine(raw)!;
    expect(ev.type).toBe('user');
    expect(ev.toolResult).toBeUndefined();
  });
});

describe('result 事件（C5：usage 必须白名单取值）', () => {
  it('抽出终态字段', () => {
    const ev = parseStreamLine(fixtureLines[8])!;
    expect(ev.type).toBe('result');
    expect(ev.result?.subtype).toBe('success');
    expect(ev.result?.isError).toBe(false);
    expect(ev.result?.numTurns).toBeGreaterThan(0);
    expect(ev.result?.totalCostUsd).toBeGreaterThan(0);
    expect(ev.result?.stopReason).toBe('end_turn');
  });

  it('usage 只保留白名单里的数值字段，嵌套对象与字符串被丢掉', () => {
    const ev = parseStreamLine(fixtureLines[8])!;
    const usage = ev.result!.usage;
    expect(Object.keys(usage).every((k) => (USAGE_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(Object.values(usage).every((v) => typeof v === 'number')).toBe(true);
    expect(usage.input_tokens).toBeGreaterThan(0);
    expect('server_tool_use' in usage).toBe(false);
    expect('service_tier' in usage).toBe(false);
    expect('cache_creation' in usage).toBe(false);
  });

  it('pickUsage 对完全非法的入参返回空对象', () => {
    expect(pickUsage(null)).toEqual({});
    expect(pickUsage('x')).toEqual({});
    expect(pickUsage({ input_tokens: 'oops' })).toEqual({});
  });

  it('result_text 是双重编码的 JSON 字符串时解一层', () => {
    const raw = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify('解出来') });
    expect(parseStreamLine(raw)!.result?.resultText).toBe('解出来');
  });

  it('permission_denials 抽出工具名列表', () => {
    const raw = JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: 'ok',
      permission_denials: [{ tool_name: 'Bash', tool_use_id: 'x' }],
    });
    expect(parseStreamLine(raw)!.result?.permissionDenials).toEqual(['Bash']);
  });
});

describe('parseStreamText：逐行切分', () => {
  it('整份 fixture 解析出 9 条事件，无效行不产出', () => {
    const withNoise = [...fixtureLines.slice(0, 3), '', 'garbage', ...fixtureLines.slice(3)].join('\n');
    const events = parseStreamText(withNoise);
    expect(events).toHaveLength(9);
  });

  it('分块喂入与整块喂入结果一致（模拟 stdout chunk 切分）', () => {
    const whole = parseStreamText(fixtureLines.join('\n'));
    expect(whole).toHaveLength(9);
    expect(whole[3].messageId).toBe(parseStreamText(fixtureLines[3]).at(0)!.messageId);
  });
});

describe('isResumeMissing（R2 实测）', () => {
  it('只有 error_during_execution + num_turns=0 + 无 assistant → true', () => {
    const events = parseStreamText(JSON.stringify({
      type: 'result', subtype: 'error_during_execution', is_error: true,
      num_turns: 0, total_cost_usd: 0, result: '', session_id: 'x',
    }));
    expect(isResumeMissing(events)).toBe(true);
  });

  it('出现任意 assistant 事件 → false（真的跑过内容，不是 resume 失败）', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 0 }),
    ].join('\n');
    expect(isResumeMissing(parseStreamText(lines))).toBe(false);
  });

  it('num_turns 非 0 → false', () => {
    const events = parseStreamText(JSON.stringify({
      type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 3,
    }));
    expect(isResumeMissing(events)).toBe(false);
  });

  it('成功 result → false', () => {
    const events = parseStreamText(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1 }));
    expect(isResumeMissing(events)).toBe(false);
  });

  it('没有任何 result 事件 → false（调用方按进程失败处理）', () => {
    expect(isResumeMissing([])).toBe(false);
    expect(isResumeMissing(parseStreamText(JSON.stringify({ type: 'stderr', text: 'x' })))).toBe(false);
  });
});

describe('normalizeToolResultContent', () => {
  it('三态 + 未知类型全部安全处理', () => {
    expect(normalizeToolResultContent('abc')).toBe('abc');
    expect(normalizeToolResultContent(null)).toBe('');
    expect(normalizeToolResultContent(undefined)).toBe('');
    expect(normalizeToolResultContent(42)).toBe('42');
    expect(normalizeToolResultContent([])).toBe('');
    expect(normalizeToolResultContent([{ type: 'text', text: 'a' }, { type: 'image' }])).toBe('[图片]\na');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- tests/main/tasks/streamParse.test.ts`
Expected: FAIL — 无法解析 `streamParse.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/tasks/streamParse.ts
// 纯函数：claude -p --output-format stream-json 的 NDJSON 行 → 归一化事件。
// 主进程与渲染进程是两个独立 bundle，不能互相 import，所以「原始行 → 结构化」
// 只在这里做一次；tasks:runEvents IPC 返回本文件的产物，渲染层只做 UI 折叠。
// 所有形状都按 2026-09-18 本机 claude 2.1.114 实测（见 spec §8.4 / fixture）设计。

export type NormalizedBlock =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export interface InitInfo {
  model: string;
  cwd: string;
  toolCount: number;
  claudeCodeVersion: string;
  permissionMode: string;
  failedMcpServers: string[];
}

export interface ResultSummary {
  subtype: string;
  isError: boolean;
  resultText: string;
  numTurns: number;
  durationMs: number;
  totalCostUsd: number;
  stopReason: string | null;
  terminalReason: string | null;
  permissionDenials: string[];
  /** 只含 USAGE_KEYS 里的数值字段（C5：原始 usage 含嵌套对象与字符串） */
  usage: Record<string, number>;
}

export interface NormalizedEvent {
  type: 'system' | 'assistant' | 'user' | 'result' | 'stderr';
  subtype?: string;
  /** assistant / user 的消息分组键（C1：一个 block 一行，同一 id 跨多行） */
  messageId?: string;
  /** 非 null 表示来自子代理 */
  parentToolUseId?: string | null;
  blocks?: NormalizedBlock[];
  toolResult?: { toolUseId: string; content: string; isError: boolean };
  init?: InitInfo;
  hook?: { name: string; ok: boolean };
  result?: ResultSummary;
  /** 仅 stderr 事件 */
  text?: string;
}

export const USAGE_KEYS = [
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
] as const;

export function normalizeToolResultContent(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
      else if (block.type === 'image') parts.push('[图片]');
    }
    return parts.join('\n');
  }
  if (typeof content === 'object') return JSON.stringify(content);
  return String(content);
}

export function pickUsage(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const key of USAGE_KEYS) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** result.result 有时是双重编码的 JSON 字符串，解一层。 */
function decodeResultText(v: unknown): string {
  if (typeof v !== 'string') return v == null ? '' : JSON.stringify(v);
  const trimmed = v.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed;
    } catch {
      /* 保持原样 */
    }
  }
  return v;
}

function parseAssistant(raw: Record<string, unknown>): NormalizedEvent {
  const msg = obj(raw.message) ?? {};
  const content = msg.content;
  const blocks: NormalizedBlock[] = [];
  if (typeof content === 'string') {
    if (content) blocks.push({ type: 'text', text: content });
  } else if (Array.isArray(content)) {
    for (const b of content) {
      const block = obj(b);
      if (!block) continue;
      if (block.type === 'thinking') {
        const text = str(block.thinking);
        if (text) blocks.push({ type: 'thinking', text }); // 空 thinking block 真实存在，必须过滤
      } else if (block.type === 'text') {
        const text = str(block.text);
        if (text) blocks.push({ type: 'text', text });
      } else if (block.type === 'tool_use') {
        blocks.push({
          type: 'tool_use',
          id: str(block.id),
          name: str(block.name, 'unknown'),
          input: obj(block.input) ?? {},
        });
      }
    }
  }
  return {
    type: 'assistant',
    messageId: str(msg.id),
    parentToolUseId: typeof raw.parent_tool_use_id === 'string' ? raw.parent_tool_use_id : null,
    blocks,
  };
}

function parseUser(raw: Record<string, unknown>): NormalizedEvent {
  const msg = obj(raw.message) ?? {};
  const content = msg.content;
  const ev: NormalizedEvent = {
    type: 'user',
    messageId: typeof msg.id === 'string' ? msg.id : undefined,
    parentToolUseId: typeof raw.parent_tool_use_id === 'string' ? raw.parent_tool_use_id : null,
  };
  if (Array.isArray(content)) {
    for (const b of content) {
      const block = obj(b);
      if (block?.type !== 'tool_result') continue;
      ev.toolResult = {
        toolUseId: str(block.tool_use_id),
        content: normalizeToolResultContent(block.content),
        isError: block.is_error === true,
      };
      break;
    }
  }
  return ev;
}

function parseSystem(raw: Record<string, unknown>): NormalizedEvent | null {
  const subtype = str(raw.subtype);
  if (subtype === 'init') {
    const tools = Array.isArray(raw.tools) ? raw.tools : [];
    const mcp = Array.isArray(raw.mcp_servers) ? raw.mcp_servers : [];
    const failedMcpServers: string[] = [];
    for (const s of mcp) {
      const server = obj(s);
      if (server && str(server.status) === 'failed') failedMcpServers.push(str(server.name));
    }
    return {
      type: 'system',
      subtype: 'init',
      init: {
        model: str(raw.model),
        cwd: str(raw.cwd),
        toolCount: tools.length,
        claudeCodeVersion: str(raw.claude_code_version),
        permissionMode: str(raw.permissionMode),
        failedMcpServers,
      },
    };
  }
  if (subtype === 'hook_started' || subtype === 'hook_response') {
    const outcome = str(raw.outcome);
    return {
      type: 'system',
      subtype,
      hook: {
        name: str(raw.hook_name, str(raw.hook_event, 'hook')),
        ok: subtype === 'hook_started' ? true : outcome === '' || outcome === 'success',
      },
    };
  }
  return null;
}

function parseResult(raw: Record<string, unknown>): NormalizedEvent {
  const denials = Array.isArray(raw.permission_denials) ? raw.permission_denials : [];
  return {
    type: 'result',
    result: {
      subtype: str(raw.subtype),
      isError: raw.is_error === true,
      resultText: decodeResultText(raw.result),
      numTurns: num(raw.num_turns),
      durationMs: num(raw.duration_ms),
      totalCostUsd: num(raw.total_cost_usd),
      stopReason: typeof raw.stop_reason === 'string' ? raw.stop_reason : null,
      terminalReason: typeof raw.terminal_reason === 'string' ? raw.terminal_reason : null,
      permissionDenials: denials
        .map((d) => str(obj(d)?.tool_name))
        .filter((n) => n !== ''),
      usage: pickUsage(raw.usage),
    },
  };
}

export function parseStreamLine(line: string): NormalizedEvent | null {
  const trimmed = line.replace(/\r$/, '').trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const rec = obj(raw);
  if (!rec) return null;
  switch (rec.type) {
    case 'system':
      return parseSystem(rec);
    case 'assistant':
      return parseAssistant(rec);
    case 'user':
      return parseUser(rec);
    case 'result':
      return parseResult(rec);
    case 'stderr':
      return { type: 'stderr', text: str(rec.text, trimmed) };
    default:
      return null; // tool_progress / control_request / stream_event 等一律忽略
  }
}

/** 整段文本按行解析，跳过无效行。runner 用行缓冲逐行喂，测试用整段喂。 */
export function parseStreamText(text: string): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const line of text.split('\n')) {
    const ev = parseStreamLine(line);
    if (ev) out.push(ev);
  }
  return out;
}

/** R2 实测：resume 目标缺失时 claude 会吐一个 error_during_execution 的 result，
 *  num_turns=0、total_cost_usd=0，且整个 run 没有任何 assistant 事件。
 *  注意：该 result 里的 session_id 是**新生成的随机 UUID**，调用方绝不能写回 tasks.session_id。 */
export function isResumeMissing(events: NormalizedEvent[]): boolean {
  const result = events.find((e) => e.type === 'result')?.result;
  if (!result) return false;
  if (events.some((e) => e.type === 'assistant')) return false;
  return result.subtype === 'error_during_execution' && result.isError && result.numTurns === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- tests/main/tasks/streamParse.test.ts`
Expected: PASS（约 35 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/main/tasks/streamParse.ts tests/main/tasks/streamParse.test.ts
git commit -m "feat: 新增 claude stream-json 事件流解析"
```

---

## Task 8: 单次 run 的执行器（`runner.ts`）

**Files:**
- Create: `src/main/tasks/runner.ts`
- Test: `tests/main/tasks/runner.test.ts`

**Interfaces:**
- Consumes: `streamParse`（Task 7）、`store`（Task 3/4）、`tasksDir()`（Task 1）、`RUN_TIMEOUT_MS`（Task 6）
- Produces:
  - `RunnerCallbacks = { onEvent(runId: string, events: NormalizedEvent[]): void; onFinish(runId: string, status: RunStatus): void }`
  - `setRunnerDeps(deps: Partial<RunnerDeps>): void`（测试注入 spawn / 时钟）
  - `startRun(run: RunRow, task: TaskRow, cb: RunnerCallbacks): void`
  - `cancelRun(runId: string): boolean`
  - `isRunning(runId: string): boolean`
  - `killAllRuns(): Promise<void>`
  - `activeRunCount(): number`

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/tasks/runner.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { setDbFile, closeDb } from '../../../src/main/tasks/db.js';
import {
  createTask, createRun, getRun, listEventsRaw, markRunRunning, getTask, setTaskSession,
} from '../../../src/main/tasks/store.js';
import {
  setRunnerDeps, startRun, cancelRun, isRunning, buildSpawnArgs, activeRunCount, killAllRuns,
} from '../../../src/main/tasks/runner.js';

vi.mock('electron', () => ({ safeStorage: {} }));
vi.mock('tree-kill', () => ({ default: (pid: number, cb?: (e?: Error) => void) => cb?.() }));

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4242;
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

let proc: FakeProc;
let spawnArgs: { bin: string; args: string[]; opts: Record<string, unknown> } | null = null;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-runner-'));
  setDbFile(path.join(dir, 'tasks.db'));
  proc = new FakeProc();
  spawnArgs = null;
  setRunnerDeps({
    spawn: ((bin: string, args: string[], opts: Record<string, unknown>) => {
      spawnArgs = { bin, args, opts };
      return proc as never;
    }) as never,
    claudeBin: () => 'claude',
  });
});
afterEach(async () => {
  // 把上一个用例可能留下的 run 清干净，避免用例之间串状态
  await killAllRuns();
  expect(activeRunCount()).toBe(0);
  closeDb();
  setDbFile(null);
});

function seed() {
  const t = createTask({
    name: 'n', prompt: '干活', sessionId: '11111111-1111-4111-8111-111111111111',
    scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
  });
  const r = createRun(t.id, 'scheduled');
  markRunRunning(r.id);
  return { task: getTask(t.id)!, run: getRun(r.id)! };
}

describe('buildSpawnArgs', () => {
  it('首次运行用 --session-id，且必带 stream-json + verbose + bypassPermissions', () => {
    const { task } = seed();
    const args = buildSpawnArgs({ ...task, sessionInitialized: 0 });
    expect(args).toContain('-p');
    expect(args).toContain('干活');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toContain('--verbose');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
    expect(args).toContain('--session-id');
    expect(args).not.toContain('--resume');
  });

  it('已有会话后用 --resume，且不再是 --session-id', () => {
    const { task } = seed();
    const args = buildSpawnArgs({ ...task, sessionInitialized: 1 });
    expect(args).toContain('--resume');
    expect(args).not.toContain('--session-id');
    expect(args[args.indexOf('--resume') + 1]).toBe(task.sessionId);
  });
});

describe('startRun 的进程参数', () => {
  it('stdio[0] 是 ignore（否则 claude 会等 stdin 3 秒）', async () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    expect((spawnArgs!.opts.stdio as string[])[0]).toBe('ignore');
    expect(spawnArgs!.opts.windowsHide).toBe(true);
    expect(spawnArgs!.opts.detached).toBe(true);
  });

  it('剔除 CLAUDECODE（防嵌套守卫），保留其他 env', () => {
    const { task, run } = seed();
    const saved = process.env.CLAUDECODE;
    process.env.CLAUDECODE = '1';
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    expect((spawnArgs!.opts.env as Record<string, unknown>).CLAUDECODE).toBeUndefined();
    if (saved === undefined) delete process.env.CLAUDECODE;
    else process.env.CLAUDECODE = saved;
  });

  it('cwd 是 tasksDir()（所有任务共用）', () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    expect(String(spawnArgs!.opts.cwd)).toContain('tasks');
  });
});

describe('startRun 的事件落库与推送', () => {
  it('stdout 逐行落库，推送按批（同一 tick 的多行合成一批）', () => {
    const { task, run } = seed();
    const batches: number[] = [];
    startRun(run, task, { onEvent: (_id, evs) => batches.push(evs.length), onFinish: () => {} });
    proc.stdout.emit('data', Buffer.from(
      '{"type":"system","subtype":"init","model":"m","cwd":"/x","tools":["Read"],"mcp_servers":[]}\n' +
      '{"type":"assistant","message":{"id":"m1","role":"assistant","content":[{"type":"text","text":"hi"}]}}\n' +
      'garbage line\n',
    ));
    const rows = listEventsRaw(run.id);
    expect(rows.map((r) => r.type)).toEqual(['system', 'assistant']);
    expect(rows.map((r) => r.seq)).toEqual([0, 1]);
    expect(batches).toEqual([2]);
  });

  it('跨 chunk 的半行被缓冲，拼起来才算一条', () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.stdout.emit('data', Buffer.from('{"type":"stderr","text":"半'));
    expect(listEventsRaw(run.id)).toHaveLength(0);
    proc.stdout.emit('data', Buffer.from('行"}\n'));
    const rows = listEventsRaw(run.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('stderr');
  });

  it('stderr 也进流（type=stderr）', () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.stderr.emit('data', Buffer.from('some warning\n'));
    const rows = listEventsRaw(run.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('stderr');
    expect(rows[0].payload).toContain('some warning');
  });
});

describe('startRun 的终态判定', () => {
  it('以 result 事件判成败，回填 result_* 字段', async () => {
    const { task, run } = seed();
    const finished: string[] = [];
    startRun(run, task, { onEvent: () => {}, onFinish: (_id, s) => finished.push(s) });
    proc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: '完成',
      num_turns: 3, duration_ms: 1200, total_cost_usd: 0.02, stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_creation: { x: 1 }, service_tier: 'standard' },
    }) + '\n'));
    proc.emit('close', 0);
    await vi.waitFor(() => expect(isRunning(run.id)).toBe(false));
    expect(finished).toEqual(['done']);
    const got = getRun(run.id)!;
    expect(got.status).toBe('done');
    expect(got.resultText).toBe('完成');
    expect(got.numTurns).toBe(3);
    expect(got.usageJson).toBe('{"input_tokens":10,"output_tokens":5}');
  });

  it('result 的 is_error=true → status=error，stderr 尾部进 error 字段', async () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.stderr.emit('data', Buffer.from('boom\n'));
    proc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result', subtype: 'error_max_turns', is_error: true, result: '超了', num_turns: 20,
    }) + '\n'));
    proc.emit('close', 1);
    await vi.waitFor(() => expect(isRunning(run.id)).toBe(false));
    const got = getRun(run.id)!;
    expect(got.status).toBe('error');
    expect(got.resultSubtype).toBe('error_max_turns');
    expect(got.isError).toBe(1);
  });

  it('有 result 事件时即使 exit code 非 0 也按 result 判成败（已知 success+exit0 却失败的场景）', async () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 1 }) + '\n'));
    proc.emit('close', 3);
    await vi.waitFor(() => expect(isRunning(run.id)).toBe(false));
    expect(getRun(run.id)!.status).toBe('done');
  });

  it('没有 result 事件 + exit 非 0 → status=error，便于排查', async () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.stderr.emit('data', Buffer.from('Error: Invalid session ID. Must be a valid UUID.\n'));
    proc.emit('close', 1);
    await vi.waitFor(() => expect(isRunning(run.id)).toBe(false));
    const got = getRun(run.id)!;
    expect(got.status).toBe('error');
    expect(got.exitCode).toBe(1);
    expect(got.error).toContain('Invalid session ID');
  });

  it('没有 result 事件 + exit 0 → 也判 error（不能把空跑当成功）', async () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    proc.emit('close', 0);
    await vi.waitFor(() => expect(isRunning(run.id)).toBe(false));
    expect(getRun(run.id)!.status).toBe('error');
  });
});

describe('resume 回退（R2 实测判据）', () => {
  it('命中 error_during_execution + num_turns=0 + 无 assistant → 用 --session-id 重跑一次，resume_used=0', async () => {
    const t = createTask({
      name: 'n', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
    });
    setTaskSession(t.id, '11111111-1111-4111-8111-111111111111', true);
    const r = createRun(t.id, 'scheduled');
    markRunRunning(r.id);

    const spawned: string[] = [];
    setRunnerDeps({
      spawn: ((_bin: string, args: string[]) => {
        spawned.push(args.includes('--resume') ? 'resume' : 'new');
        queueMicrotask(() => {
          if (args.includes('--resume')) {
            proc.stdout.emit('data', Buffer.from(JSON.stringify({
              type: 'result', subtype: 'error_during_execution', is_error: true,
              num_turns: 0, total_cost_usd: 0, result: '', session_id: '99999999-9999-4999-8999-999999999999',
            }) + '\n'));
            proc.emit('close', 1);
          } else {
            proc.stdout.emit('data', Buffer.from(JSON.stringify({
              type: 'result', subtype: 'success', is_error: false, result: '重建成功', num_turns: 1,
            }) + '\n'));
            proc.emit('close', 0);
          }
        });
        return proc as never;
      }) as never,
      claudeBin: () => 'claude',
    });

    startRun(r, getTask(t.id)!, { onEvent: () => {}, onFinish: () => {} });
    await vi.waitFor(() => expect(isRunning(r.id)).toBe(false), { timeout: 4000 });
    expect(spawned).toEqual(['resume', 'new']);
    const got = getRun(r.id)!;
    expect(got.status).toBe('done');
    expect(got.resumeUsed).toBe(0);
    // 关键：错误 result 里的随机 session_id 绝不能写回
    expect(getTask(t.id)!.sessionId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('resume 成功时不重跑，resumeUsed=1', async () => {
    const t = createTask({
      name: 'n', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
    });
    setTaskSession(t.id, '11111111-1111-4111-8111-111111111111', true);
    const r = createRun(t.id, 'scheduled');
    markRunRunning(r.id);
    const spawned: string[] = [];
    setRunnerDeps({
      spawn: ((_bin: string, args: string[]) => {
        spawned.push(args.includes('--resume') ? 'resume' : 'new');
        queueMicrotask(() => {
          proc.stdout.emit('data', Buffer.from(JSON.stringify({
            type: 'assistant', message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
          }) + '\n'));
          proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 1 }) + '\n'));
          proc.emit('close', 0);
        });
        return proc as never;
      }) as never,
      claudeBin: () => 'claude',
    });
    startRun(r, getTask(t.id)!, { onEvent: () => {}, onFinish: () => {} });
    await vi.waitFor(() => expect(isRunning(r.id)).toBe(false), { timeout: 4000 });
    expect(spawned).toEqual(['resume']);
    expect(getRun(r.id)!.resumeUsed).toBe(1);
  });
});

describe('取消', () => {
  it('cancelRun 杀掉进程并回落为 error/interrupted 由调用方决定', () => {
    const { task, run } = seed();
    startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
    expect(isRunning(run.id)).toBe(true);
    expect(cancelRun(run.id)).toBe(true);
    expect(proc.killed).toBe(true);
    expect(cancelRun(run.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- tests/main/tasks/runner.test.ts`
Expected: FAIL — 无法解析 `runner.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/tasks/runner.ts
// 单次 run 的执行器：spawn claude -p、逐行消费 stream-json、落库、推送、超时、resume 回退。
// 不做调度决策（那是 scheduler 的职责），也不直接建 run 记录（调用方已建好 queued run）。
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import kill from 'tree-kill';
import { ensureTasksDir } from './paths.js';
import { RUN_TIMEOUT_MS } from './schedule.js';
import {
  appendEvent, finishRun, getRun, getTask, setTaskSession, touchTaskAfterRun,
  type RunRow, type RunStatus, type TaskRow,
} from './store.js';
import { isResumeMissing, parseStreamLine, type NormalizedEvent } from './streamParse.js';

export interface RunnerCallbacks {
  onEvent(runId: string, events: NormalizedEvent[]): void;
  onFinish(runId: string, status: RunStatus): void;
}

export interface RunnerDeps {
  spawn: typeof nodeSpawn;
  claudeBin(): string;
  now(): number;
}

let deps: RunnerDeps = {
  spawn: nodeSpawn,
  claudeBin: () => 'claude',
  now: () => Date.now(),
};

export function setRunnerDeps(patch: Partial<RunnerDeps>): void {
  deps = { ...deps, ...patch };
}

interface ActiveRun {
  proc: ChildProcessWithoutNullStreams;
  timer: ReturnType<typeof setTimeout> | null;
  seq: number;
  events: NormalizedEvent[];
  pending: string;
  stderrTail: string[];
  finished: boolean;
  resumeAttempted: boolean;
  exitCode: number | null;
  run: RunRow;
  task: TaskRow;
  cb: RunnerCallbacks;
}

const active = new Map<string, ActiveRun>();

export function activeRunCount(): number {
  return active.size;
}

export function isRunning(runId: string): boolean {
  return active.has(runId);
}

/** 参数构造拆出来单独可测。 */
export function buildSpawnArgs(task: TaskRow, opts: { sessionInitialized: boolean } = {
  sessionInitialized: task.sessionInitialized === 1,
}): string[] {
  const sessionFlag = opts.sessionInitialized ? '--resume' : '--session-id';
  return [
    '-p', task.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    sessionFlag, task.sessionId ?? '',
  ];
}

const STDERR_TAIL_MAX = 20;
const EVENT_FLUSH_MS = 30;

function flushEvents(a: ActiveRun): void {
  if (a.pending === '') return;
  const buf = a.pending;
  a.pending = '';
  const batch: NormalizedEvent[] = [];
  for (const line of buf.split('\n')) {
    const ev = parseStreamLine(line);
    if (!ev) continue;
    a.events.push(ev);
    try {
      appendEvent(a.run.id, a.seq, ev.type, ev.subtype ?? null, line.replace(/\r$/, ''));
      a.seq += 1;
    } catch {
      /* 落库失败不影响任务本身继续跑 */
    }
    batch.push(ev);
  }
  if (batch.length > 0) a.cb.onEvent(a.run.id, batch);
}

function finish(a: ActiveRun, status: RunStatus, extra: Parameters<typeof finishRun>[2] = {}): void {
  if (a.finished) return;
  a.finished = true;
  if (a.timer) clearTimeout(a.timer);
  active.delete(a.run.id);

  const result = a.events.find((e) => e.type === 'result')?.result;
  const errorText =
    status === 'error' && !result && a.stderrTail.length > 0 ? a.stderrTail.join('\n') : null;

  // 首次用 --session-id 成功跑完 → 把会话标记为「已建立」，之后走 --resume。
  // 漏了这一步，下次会拿同一个 id 去「新建」，claude 报 Session ID already in use，上下文再也接不上。
  if (status === 'done' && !a.resumeAttempted && a.task.sessionId) {
    try {
      setTaskSession(a.task.id, a.task.sessionId, true);
    } catch {
      /* 标记失败只影响下次是否 resume，不改变本次结果 */
    }
  }

  finishRun(a.run.id, status, {
    resumeUsed: a.resumeAttempted ? 1 : 0,
    exitCode: a.exitCode,
    sessionId: a.run.sessionId,
    ...extra,
    ...(errorText ? { error: errorText } : {}),
  });
  if (status === 'done' || status === 'error') {
    touchTaskAfterRun(a.task.id, deps.now(), status);
  }
  a.cb.onFinish(a.run.id, status);
}

function killTree(a: ActiveRun, status: RunStatus, extra: Parameters<typeof finishRun>[2] = {}): void {
  kill(a.proc.pid ?? 0, () => {
    /* 进程树已尽力; finish 不等待 */
  });
  finish(a, status, extra);
}

function spawnOnce(a: ActiveRun, useResume: boolean): void {
  const args = buildSpawnArgs(a.task, { sessionInitialized: useResume });
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDECODE; // 从 Claude Code 会话内 spawn 会被嵌套守卫挡住

  let proc: ChildProcessWithoutNullStreams;
  try {
    proc = deps.spawn(deps.claudeBin(), args, {
      cwd: ensureTasksDir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
      env,
    }) as ChildProcessWithoutNullStreams;
  } catch (err) {
    finish(a, 'error', { error: `启动 claude 失败: ${String((err as Error)?.message ?? err)}` });
    return;
  }
  a.proc = proc;
  a.resumeAttempted = useResume;

  proc.stdout.setEncoding?.('utf8');
  proc.stdout.on('data', (chunk: string | Buffer) => {
    a.pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let idx = a.pending.indexOf('\n');
    while (idx !== -1) {
      const line = a.pending.slice(0, idx);
      a.pending = a.pending.slice(idx + 1);
      const ev = parseStreamLine(line);
      if (ev) {
        a.events.push(ev);
        try {
          appendEvent(a.run.id, a.seq, ev.type, ev.subtype ?? null, line.replace(/\r$/, ''));
          a.seq += 1;
        } catch {
          /* ignore */
        }
        a.cb.onEvent(a.run.id, [ev]);
      }
      idx = a.pending.indexOf('\n');
    }
  });

  proc.stderr.setEncoding?.('utf8');
  proc.stderr.on('data', (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      a.stderrTail.push(t);
      if (a.stderrTail.length > STDERR_TAIL_MAX) a.stderrTail.shift();
      try {
        appendEvent(a.run.id, a.seq, 'stderr', null, JSON.stringify({ type: 'stderr', text: t }));
        a.seq += 1;
      } catch {
        /* ignore */
      }
      a.cb.onEvent(a.run.id, [{ type: 'stderr', text: t }]);
    }
  });

  proc.on('error', (err: Error) => {
    finish(a, 'error', { error: `进程错误: ${err.message}` });
  });

  proc.on('close', (code: number | null) => {
    // 冲掉尾部残行
    if (a.pending.trim()) {
      const ev = parseStreamLine(a.pending);
      a.pending = '';
      if (ev) {
        a.events.push(ev);
        try {
          appendEvent(a.run.id, a.seq, ev.type, ev.subtype ?? null, JSON.stringify(ev));
          a.seq += 1;
        } catch {
          /* ignore */
        }
        a.cb.onEvent(a.run.id, [ev]);
      }
    }
    a.exitCode = code;

    if (isResumeMissing(a.events)) {
      // R2 实测判据命中：resume 目标缺失 → 用 --session-id 重建一次。
      // 注意：那个错误 result 里的 session_id 是新的随机 UUID，绝不能写回。
      setTaskSession(a.task.id, a.task.sessionId ?? '', false);
      a.task = { ...a.task, sessionInitialized: 0 };
      a.events = [];
      a.stderrTail = [];
      a.seq = 0;
      spawnOnce(a, false);
      return;
    }

    const result = a.events.find((e) => e.type === 'result')?.result;
    if (result) {
      finish(a, result.isError ? 'error' : 'done', {
        isError: result.isError ? 1 : 0,
        resultSubtype: result.subtype,
        resultText: result.resultText,
        numTurns: result.numTurns,
        durationMs: result.durationMs,
        totalCostUsd: result.totalCostUsd,
        usageJson: JSON.stringify(result.usage),
      });
      return;
    }

    // 没有 result 事件：无论 exit code 是什么都不算成功
    finish(a, 'error', {
      isError: 1,
      error: a.stderrTail.length > 0 ? a.stderrTail.join('\n') : `进程退出码 ${String(code)}，无可解析的 result 事件`,
    });
  });
}

export function startRun(run: RunRow, task: TaskRow, cb: RunnerCallbacks): void {
  const a: ActiveRun = {
    proc: null as unknown as ChildProcessWithoutNullStreams,
    timer: null,
    seq: 0,
    events: [],
    pending: '',
    stderrTail: [],
    finished: false,
    resumeAttempted: task.sessionInitialized === 1,
    exitCode: null,
    run,
    task,
    cb,
  };
  active.set(run.id, a);

  a.timer = setTimeout(() => {
    if (!active.has(run.id)) return;
    killTree(a, 'timeout', { error: '超过 30 分钟上限，已终止' });
  }, RUN_TIMEOUT_MS);

  spawnOnce(a, task.sessionInitialized === 1);
}

export function cancelRun(runId: string): boolean {
  const a = active.get(runId);
  if (!a) return false;
  killTree(a, 'interrupted', { error: '用户取消' });
  return true;
}

export async function killAllRuns(): Promise<void> {
  const all = [...active.values()];
  await Promise.all(all.map((a) => new Promise<void>((resolve) => {
    kill(a.proc.pid ?? 0, () => resolve());
    finish(a, 'interrupted', { error: 'App 退出时仍在运行' });
  })));
}
```

> **`session_initialized` 的翻转必须写在 `finish()` 里**（上面的 `finish()` 代码块已含此逻辑，这里再强调一次为什么）：首次用 `--session-id` 成功跑完后如果不置 1，下次仍会拿同一个 id 去「新建」，claude 会报 `Session ID already in use` 或落到 DEAD 路径——任务的会话上下文就再也接不上了。判据是 `status === 'done' && !a.resumeAttempted && a.task.sessionId`。注意 `setTaskSession` 必须在这一步**之前**调用（先把标记置 1），再 `touchTaskAfterRun`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- tests/main/tasks/runner.test.ts`
Expected: PASS（约 14 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/main/tasks/runner.ts tests/main/tasks/runner.test.ts
git commit -m "feat: 新增任务执行器与 resume 回退"
```

---

## Task 9: 调度循环与并发队列（`scheduler.ts`）

**Files:**
- Create: `src/main/tasks/scheduler.ts`
- Test: `tests/main/tasks/scheduler.test.ts`

**Interfaces:**
- Consumes: `schedule`（Task 5/6）、`store`（Task 3/4）、`runner`（Task 8）
- Produces:
  - `setSchedulerDeps(patch: Partial<SchedulerDeps>): void`
  - `setSchedulerNotify(fn: (task: TaskRow, run: RunRow) => void): void`
  - `startScheduler(): void`
  - `stopScheduler(): void`
  - `tick(now?: number): void`（导出供测试）
  - `runTaskNow(taskId: string): string`
  - `schedulerSnapshot(): { queueLength: number; activeCount: number }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/tasks/scheduler.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDbFile, closeDb } from '../../../src/main/tasks/db.js';
import {
  createTask, getTask, updateTask, listRuns, createRun, getRun, listLiveRuns,
  markRunRunning, finishRun,
} from '../../../src/main/tasks/store.js';
import {
  setSchedulerDeps, tick, runTaskNow, startScheduler, stopScheduler, schedulerSnapshot,
} from '../../../src/main/tasks/scheduler.js';
import { CATCH_UP_MS, QUEUE_TIMEOUT_MS, computeNextRun } from '../../../src/main/tasks/schedule.js';

vi.mock('electron', () => ({ safeStorage: {} }));
vi.mock('tree-kill', () => ({ default: (_pid: number, cb?: (e?: Error) => void) => cb?.() }));

const started: string[] = [];
const finished: Array<{ runId: string; status: string }> = [];
let failStart = false;

const NOW = new Date('2026-09-18T09:00:00').getTime();

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-sched-'));
  setDbFile(path.join(dir, 'tasks.db'));
  started.length = 0;
  finished.length = 0;
  failStart = false;
  setSchedulerDeps({
    now: () => NOW,
    readConcurrency: () => 2,
    runner: {
      start(run, task) {
        started.push(run.id);
        if (failStart) {
          finished.push({ runId: run.id, status: 'error' });
        }
      },
    },
  });
});
afterEach(() => {
  stopScheduler();
  closeDb();
  setDbFile(null);
});

function cronTask(name: string, expr: string, nextRunAt: number | null) {
  return createTask({
    name, prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
    scheduleType: 'cron', scheduleExpr: expr, runAt: null, nextRunAt,
  });
}

describe('tick：到期判定', () => {
  it('nextRunAt 为空 → 只计算落库，不触发', () => {
    const t = cronTask('A', '0 9 * * *', null);
    tick(NOW);
    const after = getTask(t.id)!;
    expect(after.nextRunAt).toBe(computeNextRun({ type: 'cron', expression: '0 9 * * *' }, NOW));
    expect(started).toHaveLength(0);
  });

  it('未到点 → 不触发', () => {
    cronTask('A', '0 9 * * *', NOW + 60_000);
    tick(NOW);
    expect(started).toHaveLength(0);
  });

  it('到点 → 建 queued run、推进 nextRunAt、启动执行', () => {
    const t = cronTask('A', '0 9 * * *', NOW);
    const before = listRuns(t.id, { limit: 10 }).length;
    tick(NOW);
    const runs = listRuns(t.id, { limit: 10 });
    expect(runs.length).toBe(before + 1);
    expect(started).toHaveLength(1);
    expect(getRun(started[0])!.trigger).toBe('scheduled');
    expect(getTask(t.id)!.nextRunAt).toBe(computeNextRun({ type: 'cron', expression: '0 9 * * *' }, NOW));
  });

  it('超过补跑窗口 → 跳过并重排下一次，不建 run', () => {
    const t = cronTask('A', '0 9 * * *', NOW - CATCH_UP_MS - 1);
    tick(NOW);
    expect(started).toHaveLength(0);
    expect(listRuns(t.id, { limit: 10 })).toHaveLength(0);
    expect(getTask(t.id)!.nextRunAt).toBeGreaterThan(NOW);
  });

  it('窗口边界内（正好 60 分钟）→ 补跑', () => {
    cronTask('A', '0 9 * * *', NOW - CATCH_UP_MS);
    tick(NOW);
    expect(started).toHaveLength(1);
  });

  it('once 超窗 → 标 missed 且 enabled=0，不建 run', () => {
    const t = createTask({
      name: 'once', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'once', scheduleExpr: null, runAt: NOW - CATCH_UP_MS - 1, nextRunAt: NOW - CATCH_UP_MS - 1,
    });
    tick(NOW);
    const after = getTask(t.id)!;
    expect(after.lastStatus).toBe('missed');
    expect(after.enabled).toBe(0);
    expect(after.nextRunAt).toBeNull();
    expect(listRuns(t.id, { limit: 10 })).toHaveLength(0);
  });

  it('停用任务不参与 tick', () => {
    const t = cronTask('A', '0 9 * * *', NOW);
    updateTask(t.id, { enabled: false });
    tick(NOW);
    expect(started).toHaveLength(0);
  });
});

describe('tick：单任务去重', () => {
  it('已有非终态 run 的任务本 tick 跳过，且不推进 nextRunAt', () => {
    const t = cronTask('A', '0 9 * * *', NOW);
    createRun(t.id, 'scheduled'); // 遗留 queued
    const before = getTask(t.id)!.nextRunAt;
    tick(NOW);
    expect(started).toHaveLength(0);
    expect(getTask(t.id)!.nextRunAt).toBe(before);
  });
});

describe('tick：并发与队列', () => {
  it('并发满了之后超出的任务留在队列，下一次 tick 继续启动', () => {
    const a = cronTask('A', '0 9 * * *', NOW);
    const b = cronTask('B', '0 9 * * *', NOW);
    const c = cronTask('C', '0 9 * * *', NOW);
    tick(NOW);
    expect(started).toHaveLength(2);
    expect(schedulerSnapshot().queueLength).toBe(1);
    expect(listLiveRuns()).toHaveLength(3);
  });

  it('排队超 30 分钟仍未启动 → 标 skipped，不入队', () => {
    // 并发上限 1：A 占住，B 只能排队
    setSchedulerDeps({ readConcurrency: () => 1 });
    cronTask('A', '0 9 * * *', NOW);
    const b = cronTask('B', '0 9 * * *', NOW);
    tick(NOW);
    expect(schedulerSnapshot().queueLength).toBe(1);

    // 让 A 正常结束（并发空出），并把时钟推过排队上限，再 tick
    const runA = getRun(started[0])!;
    markRunRunning(runA.id);
    finishRun(runA.id, 'done');
    setSchedulerDeps({ now: () => NOW + QUEUE_TIMEOUT_MS + 60_000 });
    tick(NOW + QUEUE_TIMEOUT_MS + 60_000);

    const runs = listRuns(b.id, { limit: 10 });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('skipped');
    expect(runs[0].error).toContain('排队超过 30 分钟');
  });

  it('并发上限从设置读取（读到 1 时只启动 1 个）', () => {
    setSchedulerDeps({ readConcurrency: () => 1 });
    cronTask('A', '0 9 * * *', NOW);
    cronTask('B', '0 9 * * *', NOW);
    tick(NOW);
    expect(started).toHaveLength(1);
  });

  it('readConcurrency 返回非法值时回退到 6', () => {
    setSchedulerDeps({ readConcurrency: () => 0 });
    for (let i = 0; i < 8; i += 1) cronTask(`T${i}`, '0 9 * * *', NOW);
    tick(NOW);
    expect(started).toHaveLength(6);
  });
});

describe('启动恢复', () => {
  it('startScheduler 把遗留 queued run 重新入队并启动', () => {
    const t = cronTask('A', '0 9 * * *', NOW + 3_600_000);
    createRun(t.id, 'scheduled'); // 崩溃时排队的
    startScheduler();
    expect(started).toHaveLength(1);
    stopScheduler();
  });

  it('startScheduler 把遗留 running run 标成 interrupted（无进程可救）', () => {
    const t = cronTask('A', '0 9 * * *', NOW + 3_600_000);
    const r = createRun(t.id, 'scheduled');
    markRunRunning(r.id);
    startScheduler();
    const got = getRun(r.id)!;
    expect(got.status).toBe('interrupted');
    expect(got.error).toBe('App 退出时仍在运行');
    stopScheduler();
  });
});

describe('runTaskNow', () => {
  it('建 manual run 并立即开始，不改变 nextRunAt', () => {
    const t = cronTask('A', '0 9 * * *', NOW + 3_600_000);
    const before = getTask(t.id)!.nextRunAt;
    const runId = runTaskNow(t.id);
    expect(getRun(runId)!.trigger).toBe('manual');
    expect(started).toEqual([runId]);
    expect(getTask(t.id)!.nextRunAt).toBe(before);
  });

  it('任务不存在时抛错', () => {
    expect(() => runTaskNow('nope')).toThrow();
  });

  it('停用的任务也能手动执行', () => {
    const t = cronTask('A', '0 9 * * *', NOW);
    updateTask(t.id, { enabled: false });
    expect(() => runTaskNow(t.id)).not.toThrow();
    expect(started).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- tests/main/tasks/scheduler.test.ts`
Expected: FAIL — 无法解析 `scheduler.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/tasks/scheduler.ts
// 30s 轮询 tick + 内存队列 + 并发闸门。状态只有 DB 一份真相，所以不用 per-task timer。
import { getStore } from '../store.js';
import {
  CATCH_UP_MS, QUEUE_TIMEOUT_MS, computeNextRun, isDue, type Schedule,
} from './schedule.js';
import {
  createRun, finishRun, getRun, getTask, listLiveRuns, listTasks, recoverStaleRuns,
  updateTask, type RunRow, type TaskRow,
} from './store.js';
import * as runner from './runner.js';

export const TICK_INTERVAL_MS = 30_000;
export const DEFAULT_CONCURRENCY = 6;

export interface SchedulerDeps {
  now(): number;
  readConcurrency(): number;
  runner: { start(run: RunRow, task: TaskRow): void };
}

let deps: SchedulerDeps = {
  now: () => Date.now(),
  readConcurrency: () => {
    const raw = getStore('settings').get('tasks_max_concurrency');
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isInteger(n) && n >= 1 ? n : DEFAULT_CONCURRENCY;
  },
  runner: { start: (run, task) => runner.startRun(run, task, runnerCallbacks) },
};

export function setSchedulerDeps(patch: Partial<SchedulerDeps>): void {
  deps = { ...deps, ...patch };
}

export type NotifyFn = (task: TaskRow, run: RunRow) => void;
let notify: NotifyFn | null = null;
export function setSchedulerNotify(fn: NotifyFn): void {
  notify = fn;
}

// ---- 事件推送（由 index.ts 注入实际实现，scheduler 不直接碰 IPC）----
export interface SchedulerCallbacks {
  onEvent(runId: string, events: unknown[]): void;
  onRunChanged(runId: string): void;
  onTasksChanged(): void;
}
let callbacks: SchedulerCallbacks = {
  onEvent: () => {},
  onRunChanged: () => {},
  onTasksChanged: () => {},
};
export function setSchedulerCallbacks(cb: SchedulerCallbacks): void {
  callbacks = cb;
}

const runnerCallbacks = {
  onEvent: (runId: string, events: unknown[]) => callbacks.onEvent(runId, events),
  onFinish: (runId: string) => {
    callbacks.onRunChanged(runId);
    callbacks.onTasksChanged();
    const run = getRun(runId);
    if (!run) return;
    const task = getTask(run.taskId);
    if (task && notify && (run.status === 'error' || run.status === 'timeout' || run.status === 'interrupted')) {
      notify(task, run);
    }
    drain();
  },
};

let timer: ReturnType<typeof setInterval> | null = null;
let queue: string[] = [];
let recovered = false;

function scheduleOf(task: TaskRow): Schedule {
  return task.scheduleType === 'once'
    ? { type: 'once', runAt: task.runAt ?? 0 }
    : { type: 'cron', expression: task.scheduleExpr ?? '' };
}

export function schedulerSnapshot(): { queueLength: number; activeCount: number } {
  return { queueLength: queue.length, activeCount: listLiveRuns().filter((r) => r.status === 'running').length };
}

function activeCount(): number {
  return listLiveRuns().filter((r) => r.status === 'running').length;
}

function concurrency(): number {
  const n = deps.readConcurrency();
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_CONCURRENCY;
}

/** 出队直到并发满；排队超时的不启动、直接标 skipped。 */
export function drain(): void {
  const now = deps.now();
  while (queue.length > 0 && activeCount() < concurrency()) {
    const runId = queue.shift()!;
    const run = getRun(runId);
    if (!run || run.status !== 'queued') continue;
    const task = getTask(run.taskId);
    if (!task) {
      finishRun(runId, 'error', { error: '任务已被删除' });
      continue;
    }
    if (now - run.queuedAt > QUEUE_TIMEOUT_MS) {
      finishRun(runId, 'skipped', { error: '排队超过 30 分钟未启动' });
      callbacks.onRunChanged(runId);
      continue;
    }
    deps.runner.start(run, task);
  }
}

export function enqueue(runId: string): void {
  queue.push(runId);
  drain();
}

export function tick(now: number = deps.now()): void {
  if (!recovered) {
    const { requeued } = recoverStaleRuns();
    for (const r of requeued) queue.push(r.id);
    recovered = true;
  }

  const tasks = listTasks({ enabledOnly: true });
  const liveTaskIds = new Set(listLiveRuns().map((r) => r.taskId));
  let changed = false;

  for (const task of tasks) {
    const due = isDue(task.nextRunAt, now, CATCH_UP_MS);

    if (due === 'not_due' && task.nextRunAt == null) {
      const next = computeNextRun(scheduleOf(task), now);
      if (next != null) {
        updateTask(task.id, { nextRunAt: next });
        changed = true;
      }
      continue;
    }

    if (due === 'missed') {
      if (task.scheduleType === 'once') {
        updateTask(task.id, { nextRunAt: null, lastStatus: 'missed', enabled: false });
      } else {
        const next = computeNextRun(scheduleOf(task), now);
        updateTask(task.id, { nextRunAt: next });
      }
      changed = true;
      continue;
    }

    if (due !== 'due') continue;

    if (liveTaskIds.has(task.id)) continue; // 单任务去重：上次没跑完，本 tick 跳过且不推进时间

    const run = createRun(task.id, 'scheduled');
    if (task.scheduleType === 'once') {
      updateTask(task.id, { nextRunAt: null, enabled: false });
    } else {
      updateTask(task.id, { nextRunAt: computeNextRun(scheduleOf(task), now) });
    }
    changed = true;
    queue.push(run.id);
    callbacks.onRunChanged(run.id);
  }

  drain();
  if (changed) callbacks.onTasksChanged();
}

export function startScheduler(): void {
  if (timer) return;
  tick();
  timer = setInterval(() => tick(), TICK_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  queue = [];
  recovered = false;
}

export function runTaskNow(taskId: string): string {
  const task = getTask(taskId);
  if (!task) throw new Error(`任务不存在: ${taskId}`);
  const run = createRun(taskId, 'manual');
  callbacks.onRunChanged(run.id);
  queue.push(run.id);
  drain();
  return run.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- tests/main/tasks/scheduler.test.ts`
Expected: PASS（约 16 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/main/tasks/scheduler.ts tests/main/tasks/scheduler.test.ts
git commit -m "feat: 新增任务调度循环与并发队列"
```

---

## Task 10: IPC、启动接线与 jsonl 扫描排除（`index.ts` + 主进程接线）

**Files:**
- Create: `src/main/tasks/index.ts`
- Modify: `src/main/jsonl.ts`（新增 `setExcludedProjects`，改 `scanAll` 与 `watchProjects`）
- Modify: `src/main/app.ts`（启动接线 + shutdown）
- Modify: `src/main/preload.ts`
- Test: `tests/main/tasks/jsonlExclude.test.ts`

**Interfaces:**
- Consumes: 全部 Task 1–9
- Produces:
  - `initTasks(getMainWindow: () => BrowserWindow | null): void`
  - `tasksShutdown(): Promise<void>`
  - `jsonl.setExcludedProjects(dirs: string[]): void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/tasks/jsonlExclude.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  setRoot, setExcludedProjects, scanAll, encodeProjectDirName, getSessionJsonlPath, listSessionIds,
} from '../../../src/main/jsonl.js';

vi.mock('electron', () => ({ safeStorage: {} }));

let root: string;

function writeSession(workDir: string, id: string, opts: { cwd?: string } = {}) {
  const dir = path.join(root, encodeProjectDirName(workDir));
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: '你好' }, cwd: opts.cwd ?? workDir, timestamp: '2026-09-18T01:00:00Z' }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi' } }),
  ];
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.join('\n') + '\n', 'utf8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-tasks-jsonl-'));
  setRoot(root);
  setExcludedProjects([]);
});
afterEach(() => {
  setExcludedProjects([]);
});

describe('setExcludedProjects', () => {
  it('被排除的项目目录不出现在 scanAll 结果里', async () => {
    const tasksDir = path.join(os.tmpdir(), 'lynel-tasks-dir-x');
    writeSession('/work/proj-a', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    writeSession(tasksDir, 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');
    expect((await scanAll()).map((s) => s.id).sort()).toEqual([
      'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
    ]);

    setExcludedProjects([tasksDir]);
    const after = await scanAll();
    expect(after.map((s) => s.id)).toEqual(['aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa']);
  });

  it('排除不影响直接路径查询（listSessionIds / getSessionJsonlPath）', () => {
    const tasksDir = path.join(os.tmpdir(), 'lynel-tasks-dir-y');
    writeSession(tasksDir, 'cccccccc-3333-4333-8333-cccccccccccc');
    setExcludedProjects([tasksDir]);
    expect(listSessionIds(tasksDir)).toEqual(['cccccccc-3333-4333-8333-cccccccccccc']);
    expect(getSessionJsonlPath('cccccccc-3333-4333-8333-cccccccccccc', tasksDir)).toContain(
      'cccccccc-3333-4333-8333-cccccccccccc.jsonl',
    );
  });

  it('传空数组恢复全部可见', async () => {
    const tasksDir = path.join(os.tmpdir(), 'lynel-tasks-dir-z');
    writeSession(tasksDir, 'dddddddd-4444-4444-8444-dddddddddddd');
    setExcludedProjects([tasksDir]);
    expect(await scanAll()).toHaveLength(0);
    setExcludedProjects([]);
    expect(await scanAll()).toHaveLength(1);
  });

  it('被排除目录的编码名没算错（含盘符/中文）', async () => {
    const tasksDir = 'G:\\我的项目\\tasks';
    writeSession(tasksDir, 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee');
    setExcludedProjects([tasksDir]);
    const all = await scanAll();
    expect(all.some((s) => s.id === 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- tests/main/tasks/jsonlExclude.test.ts`
Expected: FAIL — `setExcludedProjects is not a function`

- [ ] **Step 3: Modify `jsonl.ts`**

在 `let rootDir = ...` 下面加：

```ts
// 定时任务的工作目录不进会话扫描 —— 否则任务会话会出现在会话列表里，
// 用户点开它会让 Lynel 用同一个 sid 起交互式 PTY，与任务进程并发写坏同一个 jsonl。
// 只影响「枚举」（scanAll / watchProjects）；listSessionIds / getSessionJsonlPath 是
// 按路径直查，不受影响，所以任务自己的 --resume 照常工作。
let excludedProjects = new Set<string>();

export function setExcludedProjects(dirs: string[]): void {
  excludedProjects = new Set(dirs.map(encodeProjectDirName));
}
```

`scanAll()`（原 `:88`）里，在 `if (!entry.isDirectory()) continue;` 之后加一行：

```ts
      if (excludedProjects.has(entry.name)) continue;
```

`watchProjects()`（原 `:422`）的 chokidar 配置改成：

```ts
export function watchProjects(onChange: () => void): () => void {
  const watcher = chokidar.watch(rootDir, {
    ignored: (p) => {
      // 剪掉被排除项目目录的整棵子树
      const rel = path.relative(rootDir, p);
      if (rel && !rel.startsWith('..')) {
        const top = rel.split(path.sep)[0];
        if (excludedProjects.has(top)) return true;
      }
      const base = path.basename(p);
      void base;
      const stat = (() => {
        try {
          return fsSync.statSync(p);
        } catch {
          return null;
        }
      })();
      if (stat?.isFile() && !p.endsWith('.jsonl')) return true;
      return false;
    },
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100 },
  });
  // ...以下不变
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:main -- tests/main/tasks/jsonlExclude.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: 写 `src/main/tasks/index.ts`**

```ts
// src/main/tasks/index.ts
// 定时任务的对外入口：注册 IPC、接上事件推送、启动/停止调度器。
import { ipcMain, type BrowserWindow } from 'electron';
import { windowAttention } from '../attention.js';
import { getLogger } from '../log.js';
import { ensureTasksDir, tasksDir } from './paths.js';
import { closeDb, getDb } from './db.js';
import { computeNextRun, describeSchedule, type Schedule } from './schedule.js';
import { parseStreamLine } from './streamParse.js';
import * as scheduler from './scheduler.js';
import * as runner from './runner.js';
import {
  createTask, deleteTask, getRun, getTask, listEventsRaw, listRuns, listTasks,
  updateTask, type RunRow, type TaskRow,
} from './store.js';
import { randomUUID } from 'node:crypto';
import { setExcludedProjects } from '../jsonl.js';

let win: (() => BrowserWindow | null) | null = null;

function send(channel: string, payload: unknown): void {
  const w = win?.();
  if (!w || w.isDestroyed()) return;
  w.webContents.send(channel, payload);
}

function toTaskDto(task: TaskRow) {
  const schedule: Schedule = task.scheduleType === 'once'
    ? { type: 'once', runAt: task.runAt ?? 0 }
    : { type: 'cron', expression: task.scheduleExpr ?? '' };
  return {
    ...task,
    enabled: task.enabled === 1,
    sessionInitialized: task.sessionInitialized === 1,
    schedule: describeSchedule(schedule),
    scheduleRaw: schedule,
  };
}

function toRunDto(run: RunRow) {
  return { ...run };
}

function normalizeEvents(runId: string, afterSeq: number) {
  return listEventsRaw(runId, afterSeq).map((row) => ({
    seq: row.seq,
    ts: row.ts,
    event: parseStreamLine(row.payload) ?? { type: row.type as 'stderr', text: row.payload, subtype: row.subtype ?? undefined },
  }));
}

export function initTasks(getMainWindow: () => BrowserWindow | null): void {
  win = getMainWindow;
  const logger = getLogger();

  // 1. 建目录 + 落初始 CLAUDE.md
  try {
    ensureTasksDir();
  } catch (err) {
    logger.error(`[tasks] 建任务目录失败: ${String((err as Error)?.message ?? err)}`);
  }

  // 2. 会话扫描排除 —— 必须在任何会话扫描之前执行
  try {
    setExcludedProjects([tasksDir()]);
  } catch (err) {
    logger.error(`[tasks] 设置会话扫描排除失败: ${String((err as Error)?.message ?? err)}`);
  }

  // 3. 开库（触发 migration）
  try {
    getDb();
  } catch (err) {
    logger.error(`[tasks] 打开任务数据库失败，定时任务不可用: ${String((err as Error)?.message ?? err)}`);
    return;
  }

  scheduler.setSchedulerCallbacks({
    onEvent: (runId, events) => send('tasks:runEvent', { runId, events }),
    onRunChanged: (runId) => {
      const run = getRun(runId);
      if (run) send('tasks:runChanged', toRunDto(run));
    },
    onTasksChanged: () => send('tasks:changed', listTasks().map(toTaskDto)),
  });

  // 失败通知：只在 error / timeout / interrupted 时打扰用户
  scheduler.setSchedulerNotify((task, run) => {
    const reason = run.error || run.resultSubtype || run.status;
    void windowAttention.notifyTaskFailure(task.name, `任务失败：${reason}`).catch(() => {});
  });

  scheduler.startScheduler();

  // ---- IPC ----
  ipcMain.handle('tasks:list', () => listTasks().map(toTaskDto));

  ipcMain.handle('tasks:get', (_e, id: string) => {
    const t = getTask(id);
    return t ? toTaskDto(t) : null;
  });

  ipcMain.handle('tasks:create', (_e, input: {
    name: string; prompt: string; schedule: Schedule;
  }) => {
    const sessionId = randomUUID();
    const nextRunAt = computeNextRun(input.schedule, Date.now());
    const task = createTask({
      name: input.name.trim(),
      prompt: input.prompt,
      sessionId,
      scheduleType: input.schedule.type,
      scheduleExpr: input.schedule.type === 'cron' ? input.schedule.expression : null,
      runAt: input.schedule.type === 'once' ? input.schedule.runAt : null,
      nextRunAt,
    });
    send('tasks:changed', listTasks().map(toTaskDto));
    return toTaskDto(task);
  });

  ipcMain.handle('tasks:update', (_e, id: string, patch: {
    name?: string; prompt?: string; schedule?: Schedule; enabled?: boolean;
  }) => {
    const before = getTask(id);
    if (!before) throw new Error(`任务不存在: ${id}`);

    const fields: Parameters<typeof updateTask>[1] = {};
    if (patch.name !== undefined) fields.name = patch.name.trim();
    if (patch.prompt !== undefined) fields.prompt = patch.prompt;
    if (patch.enabled !== undefined) fields.enabled = patch.enabled;
    if (patch.schedule) {
      const s = patch.schedule;
      const changedKind = s.type !== before.scheduleType;
      fields.scheduleType = s.type;
      fields.scheduleExpr = s.type === 'cron' ? s.expression : null;
      fields.runAt = s.type === 'once' ? s.runAt : null;
      fields.nextRunAt = computeNextRun(s, Date.now());
      // once → cron 时把 enabled 恢复，否则「一次性跑完自停」的语义会让人以为坏了
      if (changedKind && s.type === 'cron') fields.enabled = true;
    }
    const updated = updateTask(id, fields);
    send('tasks:changed', listTasks().map(toTaskDto));
    return toTaskDto(updated);
  });

  ipcMain.handle('tasks:delete', (_e, id: string) => {
    deleteTask(id);
    send('tasks:changed', listTasks().map(toTaskDto));
  });

  ipcMain.handle('tasks:setEnabled', (_e, id: string, enabled: boolean) => {
    const task = getTask(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    // 重新启用且没有下次运行时间时补算一个，否则任务永远不会触发
    const patch: Parameters<typeof updateTask>[1] = { enabled };
    if (enabled && task.nextRunAt == null) {
      const s: Schedule = task.scheduleType === 'once'
        ? { type: 'once', runAt: task.runAt ?? 0 }
        : { type: 'cron', expression: task.scheduleExpr ?? '' };
      patch.nextRunAt = computeNextRun(s, Date.now());
    }
    updateTask(id, patch);
    send('tasks:changed', listTasks().map(toTaskDto));
  });

  ipcMain.handle('tasks:runNow', (_e, id: string) => scheduler.runTaskNow(id));

  ipcMain.handle('tasks:cancel', (_e, runId: string) => runner.cancelRun(runId));

  ipcMain.handle('tasks:runs', (_e, taskId: string, opts: { limit: number; before?: number }) =>
    listRuns(taskId, opts).map(toRunDto));

  ipcMain.handle('tasks:run', (_e, runId: string) => {
    const r = getRun(runId);
    return r ? toRunDto(r) : null;
  });

  ipcMain.handle('tasks:runEvents', (_e, runId: string, opts: { afterSeq?: number } = {}) =>
    normalizeEvents(runId, opts.afterSeq ?? -1));

  ipcMain.handle('tasks:preview', (_e, schedule: Schedule) => {
    const out: number[] = [];
    let cursor = Date.now();
    for (let i = 0; i < 3; i += 1) {
      const next = computeNextRun(schedule, cursor);
      if (next == null) break;
      out.push(next);
      cursor = next;
    }
    return { nextRuns: out };
  });
}

export async function tasksShutdown(): Promise<void> {
  scheduler.stopScheduler();
  await runner.killAllRuns();
  closeDb();
}
```

- [ ] **Step 6: 在 `app.ts` 接线**

在 `registerIpcHandlers()` 之后（或文件底部 shutdown 之前，按现有风格）加 import：

```ts
import { initTasks, tasksShutdown } from './tasks/index.js';
```

启动处（与 `initUpdater` 相邻的位置，即 `app.ts:1417` `initUpdater(() => this.window!);` 旁边）加：

```ts
    initTasks(() => this.window!);
```

`App.shutdown()` 里，在 `dshManager.shutdown()` 之后、「shutdown complete」日志之前加：

```ts
    // 步骤 9：定时任务 —— 停调度器、杀掉在跑的 run、关库
    try {
      await tasksShutdown();
    } catch (err) {
      getLogger().error(`[app] tasks shutdown 失败: ${String((err as Error)?.message ?? err)}`);
    }
```

- [ ] **Step 7: 在 `preload.ts` 暴露 IPC**

在 `api` 对象里加（照现有 `getAppInfo` 的写法）：

```ts
  // ---- 定时任务 ----
  tasksList: () => ipcRenderer.invoke('tasks:list'),
  tasksGet: (id: string) => ipcRenderer.invoke('tasks:get', id),
  tasksCreate: (input: unknown) => ipcRenderer.invoke('tasks:create', input),
  tasksUpdate: (id: string, patch: unknown) => ipcRenderer.invoke('tasks:update', id, patch),
  tasksDelete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
  tasksSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('tasks:setEnabled', id, enabled),
  tasksRunNow: (id: string) => ipcRenderer.invoke('tasks:runNow', id),
  tasksCancel: (runId: string) => ipcRenderer.invoke('tasks:cancel', runId),
  tasksRuns: (taskId: string, opts: unknown) => ipcRenderer.invoke('tasks:runs', taskId, opts),
  tasksRun: (runId: string) => ipcRenderer.invoke('tasks:run', runId),
  tasksRunEvents: (runId: string, opts: unknown) => ipcRenderer.invoke('tasks:runEvents', runId, opts),
  tasksPreview: (schedule: unknown) => ipcRenderer.invoke('tasks:preview', schedule),
```

- [ ] **Step 8: 在 `attention.ts` 加失败通知方法**

`attention.ts` 现有一个 **private** 的 `showNotification(entry: AttentionPendingEntry)`（`:164-178`），内容写死了「权限待审批」。把通知构造抽成一个 private `show()`，两处共用；新增 public 的 `notifyTaskFailure`。

把 `:164-178` 的 `showNotification` 替换成下面两个方法：

```ts
  /** 任务失败通知（定时任务用）。成功不打扰用户。 */
  notifyTaskFailure(taskName: string, body: string): void {
    this.show(`${APP_DISPLAY_NAME} · 任务失败`, `${taskName}\n${body}`, () =>
      this.focusMainWindow(),
    );
  }

  private showNotification(entry: AttentionPendingEntry): void {
    const dir = compactPath(entry.workDir);
    this.show(
      `${APP_DISPLAY_NAME} · 权限待审批`,
      `${entry.title}\n项目：${entry.projectName}${dir ? `\n目录：${dir}` : ''}`,
      () => this.focusSession(entry.sessionId),
    );
  }

  private show(title: string, body: string, onClick?: () => void): void {
    if (!Notification.isSupported()) return;
    try {
      const n: NotificationType = new Notification({ title, body, silent: false });
      if (onClick) n.on('click', onClick);
      n.show();
    } catch (err) {
      logger.warn('notification failed:', err);
    }
  }
```

然后在 `index.ts` 的 `setSchedulerNotify` 里改成：

```ts
  scheduler.setSchedulerNotify((task, run) => {
    const reason = run.error || run.resultSubtype || run.status;
    try {
      windowAttention.notifyTaskFailure(task.name, `任务失败：${reason}`);
    } catch (err) {
      logger.warn('[tasks] 失败通知发送失败:', err);
    }
  });
```
（`windowAttention` 与 `logger` 在 `index.ts` 顶部已经 import；`focusMainWindow()` 是该文件 `:219` 的既有 public 方法。）

- [ ] **Step 9: Run tests + 类型检查**

Run: `npm run test:main`
Expected: 全绿（含新增的 `tests/main/tasks/*`）
Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出（通过）

- [ ] **Step 10: 手动验证一遍主进程链路**

Run: `npm run dev`
然后：不要动 UI，直接确认控制台没有 `[tasks]` 开头的 error，且 `~/.lynel-desktop/tasks/CLAUDE.md` 已被创建。
Expected：文件存在；dev 控制台无 tasks 相关报错。

- [ ] **Step 11: Commit**

```bash
git add src/main/tasks/index.ts src/main/tasks/scheduler.ts src/main/jsonl.ts src/main/app.ts src/main/preload.ts src/main/attention.ts tests/main/tasks/jsonlExclude.test.ts
git commit -m "feat: 定时任务接上 IPC、启动接线与会话扫描排除"
```

---

## Task 11: 渲染层事件折叠（`utils/tasks.ts` + `types/tasks.ts`）

**Files:**
- Create: `src/renderer/src/types/tasks.ts`
- Create: `src/renderer/src/utils/tasks.ts`
- Test: `tests/main/tasks/flatten.test.ts`

**Interfaces:**
- Consumes: `src/main/tasks/streamParse.ts` 的 `parseStreamText` / `NormalizedEvent`（**仅测试里**）
- Produces:
  - `TaskDto` / `RunDto` / `NormalizedEventDto`
  - `StreamItem`（联合类型，见下）
  - `flattenRunEvents(events: NormalizedEventDto[]): StreamItem[]`
  - `toolSummary(name: string, input: Record<string, unknown>): string`

```ts
export type StreamItem =
  | { kind: 'init'; model: string; cwd: string; toolCount: number; version: string; failedMcpServers: string[] }
  | { kind: 'hook'; name: string; ok: boolean }
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; summary: string; status: 'ok' | 'error' | 'running';
      input: Record<string, unknown>; output?: string; subagent: boolean; delta?: { add: number; del: number } }
  | { kind: 'stderr'; text: string }
  | { kind: 'result'; summary: ResultSummaryDto };
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/tasks/flatten.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseStreamText } from '../../../src/main/tasks/streamParse.js';
import {
  flattenRunEvents, toolSummary, type StreamItem,
} from '../../../src/renderer/src/utils/tasks.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'stream-sample.jsonl');
const lines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);
const events = parseStreamText(lines.join('\n'));

function toolItems(items: StreamItem[]) {
  return items.filter((i) => i.kind === 'tool') as Extract<StreamItem, { kind: 'tool' }>[];
}

describe('toolSummary', () => {
  it('Bash → command', () => {
    expect(toolSummary('Bash', { command: 'ls -la' })).toBe('ls -la');
  });
  it('Read → file_path:offset-limit', () => {
    expect(toolSummary('Read', { file_path: 'a.ts', offset: 10, limit: 80 })).toBe('a.ts:10-89');
    expect(toolSummary('Read', { file_path: 'a.ts' })).toBe('a.ts');
  });
  it('Edit / Write → file_path', () => {
    expect(toolSummary('Edit', { file_path: 'a.ts' })).toBe('a.ts');
    expect(toolSummary('Write', { file_path: 'b.ts' })).toBe('b.ts');
  });
  it('Glob / Grep → pattern（Grep 附 path）', () => {
    expect(toolSummary('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
    expect(toolSummary('Grep', { pattern: 'foo', path: 'src' })).toBe('foo in src');
    expect(toolSummary('Grep', { pattern: 'foo' })).toBe('foo');
  });
  it('TodoWrite → N 项任务', () => {
    expect(toolSummary('TodoWrite', { todos: [{}, {}, {}] })).toBe('3 项任务');
  });
  it('Task → description', () => {
    expect(toolSummary('Task', { description: '查代码' })).toBe('查代码');
  });
  it('WebFetch → url，WebSearch → query', () => {
    expect(toolSummary('WebFetch', { url: 'https://x.dev' })).toBe('https://x.dev');
    expect(toolSummary('WebSearch', { query: 'foo' })).toBe('foo');
  });
  it('AskUserQuestion → 第一个问题', () => {
    expect(toolSummary('AskUserQuestion', { questions: [{ question: '选哪个？' }] })).toBe('选哪个？');
  });
  it('未知工具 → 第一个字符串字段；都没有 → 空串', () => {
    expect(toolSummary('Weird', { b: 1, a: 'first' })).toBe('first');
    expect(toolSummary('Weird', { n: 1 })).toBe('');
  });
  it('没有入参 → 空串', () => {
    expect(toolSummary('Bash', {})).toBe('');
  });
});

describe('flattenRunEvents 用真实 fixture', () => {
  const items = flattenRunEvents(events);

  it('产出 init → hook → thinking → text → tool → stderr → result 的顺序', () => {
    expect(items[0].kind).toBe('init');
    expect(items[1].kind).toBe('hook');
    expect(items.some((i) => i.kind === 'thinking')).toBe(true);
    expect(items.some((i) => i.kind === 'text')).toBe(true);
    expect(items.some((i) => i.kind === 'tool')).toBe(true);
    expect(items.at(-1)!.kind).toBe('result');
  });

  it('C1：同一 message.id 的多行合成一条消息（thinking 后紧跟 tool，不会被拆成两条独立消息）', () => {
    const kinds = items.map((i) => i.kind);
    const ti = kinds.indexOf('thinking');
    expect(kinds[ti + 1]).toBe('tool');
  });

  it('空 thinking block 不产出 item', () => {
    const thinking = items.filter((i) => i.kind === 'thinking') as Extract<StreamItem, { kind: 'thinking' }>[];
    expect(thinking.every((t) => t.text.length > 0)).toBe(true);
    expect(thinking).toHaveLength(1);
  });

  it('工具卡片带摘要与状态', () => {
    const t = toolItems(items)[0];
    expect(t.name).toBe('Bash');
    expect(t.summary).toBe('ls -la');
    expect(t.status).toBe('ok');
  });

  it('tool_use 与 tool_result 按 id 配对，输出落到同一个 item', () => {
    const t = toolItems(items)[0];
    expect(t.output).toBeTruthy();
    expect(t.output).toContain('total');
  });

  it('未配对的 tool_use 状态是 running', () => {
    const onlyToolUse = parseStreamText(JSON.stringify({
      type: 'assistant', message: { id: 'm', role: 'assistant', content: [{ type: 'tool_use', id: 'call_pending', name: 'Bash', input: { command: 'sleep' } }] },
    }));
    const out = toolItems(flattenRunEvents(onlyToolUse));
    expect(out[0].status).toBe('running');
    expect(out[0].output).toBeUndefined();
  });

  it('is_error 的 tool_result → status=error，但 pair 关系不断', () => {
    const seq = parseStreamText([
      JSON.stringify({ type: 'assistant', message: { id: 'm', role: 'assistant', content: [{ type: 'tool_use', id: 'call_bad', name: 'Bash', input: { command: 'x' } }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_bad', content: 'boom', is_error: true }] } }),
    ].join('\n'));
    const out = toolItems(flattenRunEvents(seq));
    expect(out[0].status).toBe('error');
    expect(out[0].output).toBe('boom');
  });

  it('Edit 的 delta 从 old_string / new_string 行数算出', () => {
    const seq = parseStreamText(JSON.stringify({
      type: 'assistant', message: { id: 'm', role: 'assistant', content: [{
        type: 'tool_use', id: 'call_e', name: 'Edit',
        input: { file_path: 'a.ts', old_string: 'x\ny', new_string: 'x\ny\nz' },
      }] },
    }));
    const out = toolItems(flattenRunEvents(seq));
    expect(out[0].delta).toEqual({ add: 3, del: 2 });
  });

  it('子代理（parent_tool_use_id 非 null）的 tool 标记 subagent=true', () => {
    const seq = parseStreamText(JSON.stringify({
      type: 'assistant', parent_tool_use_id: 'call_parent',
      message: { id: 'm', role: 'assistant', content: [{ type: 'tool_use', id: 'call_sub', name: 'Grep', input: { pattern: 'x' } }] },
    }));
    expect(toolItems(flattenRunEvents(seq))[0].subagent).toBe(true);
  });

  it('result 卡片带状态与成本', () => {
    const r = items.at(-1) as Extract<StreamItem, { kind: 'result' }>;
    expect(r.summary.subtype).toBe('success');
    expect(r.summary.totalCostUsd).toBeGreaterThan(0);
    expect(r.summary.usage.input_tokens).toBeGreaterThan(0);
  });

  it('stderr 事件产出 stderr item', () => {
    const seq = parseStreamText(JSON.stringify({ type: 'stderr', text: '警告' }));
    const out = flattenRunEvents(seq);
    expect(out).toEqual([{ kind: 'stderr', text: '警告' }]);
  });

  it('空输入返回空数组', () => {
    expect(flattenRunEvents([])).toEqual([]);
  });

  it('init 里的 MCP 失败被带出来', () => {
    const init = items[0] as Extract<StreamItem, { kind: 'init' }>;
    expect(init.failedMcpServers).toContain('tma1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:main -- tests/main/tasks/flatten.test.ts`
Expected: FAIL — 无法解析 `renderer/src/utils/tasks.js`

- [ ] **Step 3: 写 `src/renderer/src/types/tasks.ts`**

```ts
// src/renderer/src/types/tasks.ts
// 渲染侧类型。与主进程 store 的 row 形状一一对应（主进程索引 store.ts 的 TaskRow / RunRow）。
// 注意：渲染层不解析 NDJSON —— NormalizedEventDto 是主进程 streamParse 的产物。

export type ScheduleType = 'cron' | 'once';
export type RunStatus =
  | 'queued' | 'running' | 'done' | 'error' | 'timeout' | 'skipped' | 'interrupted';

export type ScheduleDto =
  | { type: 'cron'; expression: string }
  | { type: 'once'; runAt: number };

export interface TaskDto {
  id: string;
  name: string;
  enabled: boolean;
  prompt: string;
  agent: string | null;
  sessionId: string | null;
  sessionInitialized: boolean;
  scheduleType: ScheduleType;
  scheduleExpr: string | null;
  runAt: number | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  createdAt: number;
  updatedAt: number;
  /** 人类可读摘要，如「每天 09:00」 */
  schedule: string;
  scheduleRaw: ScheduleDto;
}

export interface RunDto {
  id: string;
  taskId: string;
  trigger: string;
  status: RunStatus;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  sessionId: string | null;
  resumeUsed: number | null;
  exitCode: number | null;
  isError: number | null;
  resultSubtype: string | null;
  resultText: string | null;
  numTurns: number | null;
  durationMs: number | null;
  totalCostUsd: number | null;
  usageJson: string | null;
  error: string | null;
  eventCount: number;
}

export interface ResultSummaryDto {
  subtype: string;
  isError: boolean;
  resultText: string;
  numTurns: number;
  durationMs: number;
  totalCostUsd: number;
  stopReason: string | null;
  terminalReason: string | null;
  permissionDenials: string[];
  usage: Record<string, number>;
}

export type NormalizedBlockDto =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export interface NormalizedEventDto {
  type: 'system' | 'assistant' | 'user' | 'result' | 'stderr';
  subtype?: string;
  messageId?: string;
  parentToolUseId?: string | null;
  blocks?: NormalizedBlockDto[];
  toolResult?: { toolUseId: string; content: string; isError: boolean };
  init?: {
    model: string; cwd: string; toolCount: number;
    claudeCodeVersion: string; permissionMode: string; failedMcpServers: string[];
  };
  hook?: { name: string; ok: boolean };
  result?: ResultSummaryDto;
  text?: string;
}

/** 已带 seq 的事件（IPC 返回的形状） */
export interface EventEnvelope {
  seq: number;
  ts: number;
  event: NormalizedEventDto;
}

export type StreamItem =
  | { kind: 'init'; model: string; cwd: string; toolCount: number; version: string; failedMcpServers: string[] }
  | { kind: 'hook'; name: string; ok: boolean }
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      summary: string;
      status: 'ok' | 'error' | 'running';
      input: Record<string, unknown>;
      output?: string;
      subagent: boolean;
      /** 仅 Edit / Write：新增与删除的行数 */
      delta?: { add: number; del: number };
    }
  | { kind: 'stderr'; text: string }
  | { kind: 'result'; summary: ResultSummaryDto };
```

- [ ] **Step 4: 写 `src/renderer/src/utils/tasks.ts`**

```ts
// src/renderer/src/utils/tasks.ts
// 纯函数：把主进程归一化后的事件流折叠成可渲染的线性条目。
// 不解析 NDJSON —— 那已经在主进程 streamParse 里做过（两个 bundle 无法共享代码）。
import type {
  EventEnvelope, NormalizedBlockDto, NormalizedEventDto, StreamItem,
} from '../types/tasks';

function firstString(v: Record<string, unknown>): string {
  for (const value of Object.values(v)) {
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function countLines(s: string): number {
  return s === '' ? 0 : s.split('\n').length;
}

/** 工具卡片一行的摘要。默认折叠，靠它辨认「这步在干嘛」。 */
export function toolSummary(name: string, input: Record<string, unknown>): string {
  const s = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (name) {
    case 'Bash':
      return s('command');
    case 'Read': {
      const file = s('file_path');
      const offset = typeof input.offset === 'number' ? input.offset : null;
      const limit = typeof input.limit === 'number' ? input.limit : null;
      if (file && offset !== null) {
        return limit !== null ? `${file}:${offset}-${offset + limit - 1}` : `${file}:${offset}+`;
      }
      return file;
    }
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return s('file_path');
    case 'Glob':
      return s('pattern');
    case 'Grep': {
      const pattern = s('pattern');
      const dir = s('path');
      if (!pattern) return dir;
      return dir ? `${pattern} in ${dir}` : pattern;
    }
    case 'TodoWrite':
      return Array.isArray(input.todos) ? `${input.todos.length} 项任务` : '';
    case 'Task':
      return s('description') || s('subagent_type');
    case 'WebFetch':
      return s('url');
    case 'WebSearch':
      return s('query');
    case 'NotebookEdit':
      return s('notebook_path');
    case 'AskUserQuestion': {
      const qs = input.questions;
      if (Array.isArray(qs) && qs.length > 0) {
        const q = qs[0] as Record<string, unknown>;
        if (typeof q?.question === 'string') return q.question;
      }
      return '';
    }
    default:
      return firstString(input);
  }
}

function editDelta(input: Record<string, unknown>): { add: number; del: number } | undefined {
  const oldS = typeof input.old_string === 'string' ? input.old_string : null;
  const newS = typeof input.new_string === 'string' ? input.new_string : null;
  if (oldS === null && newS === null) {
    const content = typeof input.content === 'string' ? input.content : null;
    if (content !== null) return { add: countLines(content), del: 0 };
    return undefined;
  }
  return { add: countLines(newS ?? ''), del: countLines(oldS ?? '') };
}

export function flattenRunEvents(events: NormalizedEventDto[] | EventEnvelope[]): StreamItem[] {
  const list: NormalizedEventDto[] = (events as unknown[]).map((e) =>
    e && typeof e === 'object' && 'event' in (e as object)
      ? (e as EventEnvelope).event
      : (e as NormalizedEventDto),
  );

  const out: StreamItem[] = [];
  /** toolUseId → 在 out 里的下标，用于回填 tool_result */
  const toolIndex = new Map<string, number>();

  for (const ev of list) {
    switch (ev.type) {
      case 'system': {
        if (ev.subtype === 'init' && ev.init) {
          out.push({
            kind: 'init',
            model: ev.init.model,
            cwd: ev.init.cwd,
            toolCount: ev.init.toolCount,
            version: ev.init.claudeCodeVersion,
            failedMcpServers: ev.init.failedMcpServers,
          });
        } else if (ev.hook) {
          out.push({ kind: 'hook', name: ev.hook.name, ok: ev.hook.ok });
        }
        break;
      }
      case 'assistant': {
        // C1：同一 message.id 的多个 block 本来就分散在多行里，按到达顺序展开即可；
        // 空 thinking 已在主进程过滤，这里再兜一层。
        for (const b of (ev.blocks ?? []) as NormalizedBlockDto[]) {
          if (b.type === 'thinking') {
            if (b.text) out.push({ kind: 'thinking', text: b.text });
          } else if (b.type === 'text') {
            if (b.text) out.push({ kind: 'text', text: b.text });
          } else {
            const delta = b.name === 'Edit' || b.name === 'Write' ? editDelta(b.input) : undefined;
            const item: StreamItem = {
              kind: 'tool',
              id: b.id,
              name: b.name,
              summary: toolSummary(b.name, b.input),
              status: 'running',
              input: b.input,
              subagent: ev.parentToolUseId != null,
              ...(delta ? { delta } : {}),
            };
            toolIndex.set(b.id, out.length);
            out.push(item);
          }
        }
        break;
      }
      case 'user': {
        const tr = ev.toolResult;
        if (!tr) break;
        const at = toolIndex.get(tr.toolUseId);
        if (at === undefined) {
          // 配对不上的 tool_result 仍然展示，不能静默丢
          out.push({ kind: 'text', text: tr.content });
          break;
        }
        const current = out[at] as Extract<StreamItem, { kind: 'tool' }>;
        out[at] = {
          ...current,
          status: tr.isError ? 'error' : 'ok',
          output: tr.content,
        };
        break;
      }
      case 'stderr':
        out.push({ kind: 'stderr', text: ev.text ?? '' });
        break;
      case 'result':
        if (ev.result) out.push({ kind: 'result', summary: ev.result });
        break;
      default:
        break;
    }
  }

  return out;
}

/** 运行历史一行的摘要文案。 */
export function runSummaryText(resultText: string | null, error: string | null, status: string): string {
  if (status === 'queued') return '排队中';
  if (status === 'running') return '—';
  if (status === 'skipped') return error ?? '排队超时未启动';
  if (status === 'interrupted') return error ?? '已中断';
  if (status === 'timeout') return error ?? '超过 30 分钟上限';
  if (status === 'error') return error ?? '执行失败';
  const first = (resultText ?? '').split('\n').find((l) => l.trim() !== '') ?? '';
  return first.slice(0, 120);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:main -- tests/main/tasks/flatten.test.ts`
Expected: PASS（约 26 个用例）

- [ ] **Step 6: Type check**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/types/tasks.ts src/renderer/src/utils/tasks.ts tests/main/tasks/flatten.test.ts
git commit -m "feat: 新增任务事件流折叠纯函数"
```

---

## Task 12: 渲染层 IPC 封装与 Pinia store

**Files:**
- Modify: `src/renderer/src/composables/useElectron.ts`
- Create: `src/renderer/src/stores/tasks.ts`

**Interfaces:**
- Consumes: `preload.ts` 的 `tasks*`（Task 10）、`types/tasks.ts`（Task 11）
- Produces:
  - `useElectron.ts` 导出：`TasksList / TasksGet / TasksCreate / TasksUpdate / TasksDelete / TasksSetEnabled / TasksRunNow / TasksCancel / TasksRuns / TasksRun / TasksRunEvents / TasksPreview` 与 `OnTasksChanged / OnTasksRunChanged / OnTasksRunEvent`
  - `useTasksStore()`：`tasks` / `activeTaskId` / `runs` / `activeRunId` / `events` / `loading` / `runsHasMore` + `load()` / `select(id)` / `saveTask(input)` / `remove(id)` / `setEnabled(id, on)` / `runNow(id)` / `cancel(runId)` / `loadRuns(more?)` / `openRun(runId)` / `closeRun()` / `preview(schedule)`

- [ ] **Step 1: 在 `useElectron.ts` 加封装**

照文件里既有的写法（`api()` 空检查 + 导出包装）。追加：

```ts
// ---- 定时任务 ----
export const TasksList = () => api().tasksList();
export const TasksGet = (id: string) => api().tasksGet(id);
export const TasksCreate = (input: unknown) => api().tasksCreate(input);
export const TasksUpdate = (id: string, patch: unknown) => api().tasksUpdate(id, patch);
export const TasksDelete = (id: string) => api().tasksDelete(id);
export const TasksSetEnabled = (id: string, enabled: boolean) => api().tasksSetEnabled(id, enabled);
export const TasksRunNow = (id: string) => api().tasksRunNow(id);
export const TasksCancel = (runId: string) => api().tasksCancel(runId);
export const TasksRuns = (taskId: string, opts: { limit: number; before?: number }) => api().tasksRuns(taskId, opts);
export const TasksRun = (runId: string) => api().tasksRun(runId);
export const TasksRunEvents = (runId: string, opts: { afterSeq?: number } = {}) => api().tasksRunEvents(runId, opts);
export const TasksPreview = (schedule: unknown) => api().tasksPreview(schedule);

export const OnTasksChanged = (cb: (tasks: unknown) => void) => EventsOn('tasks:changed', cb);
export const OnTasksRunChanged = (cb: (run: unknown) => void) => EventsOn('tasks:runChanged', cb);
export const OnTasksRunEvent = (cb: (payload: unknown) => void) => EventsOn('tasks:runEvent', cb);
```

同时在 `preload.ts` 对应的类型声明（`window.electronAPI` 的 interface，如果该文件里有）补上同名方法签名。

- [ ] **Step 2: 写 `stores/tasks.ts`**

```ts
// src/renderer/src/stores/tasks.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  TasksList, TasksCreate, TasksUpdate, TasksDelete, TasksSetEnabled, TasksRunNow,
  TasksCancel, TasksRuns, TasksRun, TasksRunEvents, TasksPreview,
  OnTasksChanged, OnTasksRunChanged, OnTasksRunEvent,
} from '../composables/useElectron';
import type { EventEnvelope, NormalizedEventDto, RunDto, ScheduleDto, TaskDto } from '../types/tasks';

const RUN_PAGE = 30;

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref<TaskDto[]>([]);
  const activeTaskId = ref<string | null>(null);
  const runs = ref<RunDto[]>([]);
  const runsHasMore = ref(false);
  const activeRunId = ref<string | null>(null);
  const events = ref<EventEnvelope[]>([]);
  const loading = ref(false);
  const loadError = ref<string | null>(null);
  /** 运行流水是否开启底部自动跟随 */
  const followTail = ref(true);

  const activeTask = computed(() => tasks.value.find((t) => t.id === activeTaskId.value) ?? null);
  const activeRun = computed(() => runs.value.find((r) => r.id === activeRunId.value) ?? null);

  async function load() {
    loading.value = true;
    loadError.value = null;
    try {
      tasks.value = (await TasksList()) as TaskDto[];
      if (activeTaskId.value && !tasks.value.some((t) => t.id === activeTaskId.value)) {
        activeTaskId.value = null;
        runs.value = [];
      }
      if (!activeTaskId.value && tasks.value.length > 0) {
        await select(tasks.value[0].id);
      }
    } catch (err) {
      loadError.value = String((err as Error)?.message ?? err);
    } finally {
      loading.value = false;
    }
  }

  async function select(id: string) {
    activeTaskId.value = id;
    activeRunId.value = null;
    events.value = [];
    runs.value = [];
    runsHasMore.value = false;
    await loadRuns(false);
  }

  async function loadRuns(more: boolean) {
    if (!activeTaskId.value) return;
    const before = more ? runs.value.at(-1)?.queuedAt : undefined;
    const page = (await TasksRuns(activeTaskId.value, { limit: RUN_PAGE, ...(before ? { before } : {}) })) as RunDto[];
    runs.value = more ? [...runs.value, ...page] : page;
    runsHasMore.value = page.length === RUN_PAGE;
  }

  async function saveTask(input: { name: string; prompt: string; schedule: ScheduleDto }, id?: string) {
    if (id) await TasksUpdate(id, input);
    else {
      const created = (await TasksCreate(input)) as TaskDto;
      activeTaskId.value = created.id;
    }
    await load();
    if (id && activeTaskId.value === id) await select(id);
  }

  async function remove(id: string) {
    await TasksDelete(id);
    if (activeTaskId.value === id) {
      activeTaskId.value = null;
      runs.value = [];
      activeRunId.value = null;
      events.value = [];
    }
    await load();
  }

  async function setEnabled(id: string, on: boolean) {
    await TasksSetEnabled(id, on);
    await load();
  }

  async function runNow(id: string) {
    await TasksRunNow(id);
    if (activeTaskId.value !== id) await select(id);
    else await loadRuns(false);
  }

  async function cancel(runId: string) {
    await TasksCancel(runId);
  }

  /** 打开某次 run 的完整流水：先补齐已有事件，再靠推送增量追加 */
  async function openRun(runId: string) {
    activeRunId.value = runId;
    events.value = [];
    followTail.value = true;
    const initial = (await TasksRunEvents(runId, {})) as EventEnvelope[];
    events.value = initial;
  }

  function closeRun() {
    activeRunId.value = null;
    events.value = [];
  }

  async function preview(schedule: ScheduleDto): Promise<number[]> {
    const res = (await TasksPreview(schedule)) as { nextRuns: number[] };
    return res.nextRuns;
  }

  // ---- 主进程推送 ----
  function bindPush(): () => void {
    const off1 = OnTasksChanged((list) => {
      const next = (list ?? []) as TaskDto[];
      tasks.value = next;
    });
    const off2 = OnTasksRunChanged((run) => {
      const r = run as RunDto | null;
      if (!r) return;
      if (r.taskId === activeTaskId.value) {
        const idx = runs.value.findIndex((x) => x.id === r.id);
        runs.value = idx === -1 ? [r, ...runs.value] : runs.value.map((x) => (x.id === r.id ? r : x));
      }
    });
    const off3 = OnTasksRunEvent((payload) => {
      const p = payload as { runId: string; events: Array<NormalizedEventDto | EventEnvelope> };
      if (!p || p.runId !== activeRunId.value) return;
      const incoming = (p.events ?? []).map((e, i) =>
        ('event' in (e as object)
          ? (e as EventEnvelope)
          : { seq: events.value.length + i, ts: Date.now(), event: e as NormalizedEventDto }),
      );
      events.value = [...events.value, ...incoming];
    });
    return () => {
      off1();
      off2();
      off3();
    };
  }

  return {
    tasks, activeTaskId, runs, runsHasMore, activeRunId, events, loading, loadError, followTail,
    activeTask, activeRun,
    load, select, loadRuns, saveTask, remove, setEnabled, runNow, cancel,
    openRun, closeRun, preview, bindPush,
  };
});
```

- [ ] **Step 3: Type check**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/composables/useElectron.ts src/renderer/src/stores/tasks.ts src/main/preload.ts
git commit -m "feat: 新增任务 IPC 封装与前端 store"
```

---

## Task 13: 入口、tab 与任务面板骨架（`TasksPane` + `TaskList`）

**Files:**
- Modify: `src/renderer/src/types/tab.ts:1`
- Modify: `src/renderer/src/stores/tabs.ts`
- Modify: `src/renderer/src/components/GlobalTabs.vue`
- Modify: `src/renderer/src/components/Icon.vue`
- Modify: `src/renderer/src/views/HomeView.vue`
- Create: `src/renderer/src/components/tasks/TasksPane.vue`
- Create: `src/renderer/src/components/tasks/TaskList.vue`

**Interfaces:**
- Consumes: `useTasksStore`（Task 12）、设计稿第 2 节
- Produces: tab 类型 `'tasks'`、`tabs.openTasks()`、`<TasksPane />`

- [ ] **Step 1: 注册图标**

先读 `src/renderer/src/components/Icon.vue`，确认 `icons` 映射里是否有 `alarm-clock` / `search` / `filter` / `plus` / `chevron-down` / `power` / `play` / `pencil` / `trash` / `check` / `alert` / `clock` / `slash`。缺哪个补哪个，格式照现有行：

```ts
import { AlarmClock, Search, Filter, Plus, ChevronDown, Power, Play, Pencil, Trash2, Check, AlertTriangle, Clock, Slash } from '@lucide/vue'
// 在 icons 映射里追加（键名与设计稿一致）
// alarm-clock: AlarmClock, filter: Filter, power: Power, slash: Slash,
```
（`@lucide/vue` 的确切导出名以现有 import 风格为准；若某图标已注册则跳过。）

- [ ] **Step 2: tab 类型与 store**

```ts
// src/renderer/src/types/tab.ts:1
export type TabType = 'welcome' | 'session' | 'settings' | 'guide' | 'harness' | 'tasks'
```

```ts
// src/renderer/src/stores/tabs.ts —— 照 openGuide 追加
  function openTasks() {
    return open({ type: 'tasks', title: '任务' })
  }
```
并在 `return { ... }` 里加入 `openTasks`。

- [ ] **Step 3: GlobalTabs 图标映射**

在 `GlobalTabs.vue` 的图标映射（该文件 14–18 行附近）加一条 `tasks` 分支，图标名用上一步注册的键。

- [ ] **Step 4: 写 `TaskList.vue`**

```vue
<!-- src/renderer/src/components/tasks/TaskList.vue -->
<template>
  <div class="tlist" :style="{ width: width + 'px' }">
    <div class="tlist-hd">
      <button class="btn primary" @click="$emit('create')"><Icon name="plus" :size="14" />新建任务</button>
    </div>
    <div class="filters">
      <div class="search">
        <Icon name="search" :size="12" />
        <input v-model="keyword" placeholder="搜索任务…" />
      </div>
      <div class="filterwrap">
        <button class="btn" :class="{ on: filterOpen }" @click="filterOpen = !filterOpen">
          <Icon name="filter" :size="14" />筛选
        </button>
        <div v-if="filterOpen" class="dropdown">
          <div class="dd-hd">状态</div>
          <div
            v-for="opt in FILTERS"
            :key="opt.value"
            class="dd-item"
            :class="{ on: filter === opt.value }"
            @click="filter = opt.value"
          >
            <span class="dot2" />{{ opt.label }}
          </div>
          <div class="dd-sep" />
          <div class="dd-acts">
            <button class="btn" @click="batch(true)">全部启用</button>
            <button class="btn" @click="batch(false)">全部停用</button>
          </div>
        </div>
      </div>
    </div>

    <div class="trows">
      <template v-for="group in grouped" :key="group.label">
        <div v-if="group.label" class="group-label">{{ group.label }}</div>
        <div
          v-for="t in group.items"
          :key="t.id"
          class="trow"
          :class="{ sel: t.id === activeId, off: !t.enabled }"
          @click="$emit('select', t.id)"
        >
          <span class="sd" :class="statusClass(t)" />
          <span class="nm">{{ t.name }}</span>
          <button
            class="toggle"
            :title="t.enabled ? '停用' : '启用'"
            @click.stop="$emit('toggle', t.id, !t.enabled)"
          >
            <Icon name="power" :size="12" />
          </button>
          <span class="meta">
            {{ t.schedule }}
            <span class="next">· {{ nextText(t) }}</span>
          </span>
        </div>
      </template>
      <div v-if="visible.length === 0" class="empty">暂无任务</div>
    </div>

    <div class="drag-handle" @mousedown="$emit('start-resize', $event)" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../Icon.vue'
import type { TaskDto } from '../../types/tasks'
import { formatRelTime } from '../../utils/time'

const props = defineProps<{ tasks: TaskDto[]; activeId: string | null; width: number }>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'toggle', id: string, enabled: boolean): void
  (e: 'create'): void
  (e: 'start-resize', ev: MouseEvent): void
}>()

type FilterValue = 'all' | 'enabled' | 'disabled' | 'failed'
const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
  { value: 'failed', label: '上次失败' },
]
const FAILED = new Set(['error', 'timeout', 'interrupted'])

const keyword = ref('')
const filter = ref<FilterValue>('all')
const filterOpen = ref(false)

const visible = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return props.tasks.filter((t) => {
    if (kw && !t.name.toLowerCase().includes(kw) && !t.prompt.toLowerCase().includes(kw)) return false
    if (filter.value === 'enabled' && !t.enabled) return false
    if (filter.value === 'disabled' && t.enabled) return false
    if (filter.value === 'failed' && !FAILED.has(t.lastStatus ?? '')) return false
    return true
  })
})

/** 启用且有待运行时间的排前面（按 nextRunAt 升序），停用/无下次的沉底成一组 */
const grouped = computed(() => {
  const pending = visible.value
    .filter((t) => t.enabled && t.nextRunAt != null)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
  const rest = visible.value
    .filter((t) => !(t.enabled && t.nextRunAt != null))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  const groups: Array<{ label: string; items: TaskDto[] }> = []
  if (pending.length) groups.push({ label: '', items: pending })
  if (rest.length) groups.push({ label: '已停用 / 已过期', items: rest })
  return groups
})

function statusClass(t: TaskDto): string {
  if (FAILED.has(t.lastStatus ?? '')) return 'err'
  if (t.lastStatus === 'running') return 'run'
  return t.enabled ? 'on' : 'off'
}

function nextText(t: TaskDto): string {
  if (!t.enabled) return t.lastStatus === 'missed' ? '已过期' : '已停用'
  if (t.nextRunAt == null) return '—'
  return `${formatRelTime(Math.floor(t.nextRunAt / 1000))}`
}

async function batch(on: boolean) {
  filterOpen.value = false
  for (const t of visible.value) {
    if (t.enabled !== on) emit('toggle', t.id, on)
  }
}
</script>
```
> 样式从设计稿第 2 节的 `.tlist / .tlist-hd / .filters / .search / .filterwrap / .dropdown / .dd-* / .trows / .trow / .sd / .toggle / .group-label` 逐条搬过来（CSS 变量名保持不变）。`.drag-handle` 是右边缘 4px 宽的拖拽热区（`cursor: col-resize`）。

- [ ] **Step 5: 写 `TasksPane.vue`**

```vue
<!-- src/renderer/src/components/tasks/TasksPane.vue -->
<template>
  <div class="tasks-pane">
    <TaskList
      :tasks="store.tasks"
      :active-id="store.activeTaskId"
      :width="listWidth"
      @select="store.select"
      @toggle="store.setEnabled"
      @create="openForm(null)"
      @start-resize="startResize"
    />
    <TaskDetailPane
      v-if="store.activeTask"
      :task="store.activeTask"
      :runs="store.runs"
      :has-more="store.runsHasMore"
      :active-run="store.activeRun"
      @edit="openForm(store.activeTask)"
      @remove="onRemove"
      @run-now="store.runNow"
      @load-more="store.loadRuns(true)"
      @open-run="store.openRun"
      @cancel="store.cancel"
      @close-run="store.closeRun"
    />
    <div v-else class="empty-detail">左侧选择一个任务，或新建一个</div>

    <TaskFormDialog
      v-if="formOpen"
      :task="formTask"
      @close="formOpen = false"
      @submit="onSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import TaskList from './TaskList.vue'
import TaskDetailPane from './TaskDetailPane.vue'
import TaskFormDialog from './TaskFormDialog.vue'
import { useTasksStore } from '../../stores/tasks'
import type { ScheduleDto, TaskDto } from '../../types/tasks'

const WIDTH_KEY = 'lynel:tasks-list-width'
const store = useTasksStore()
const listWidth = ref(Number(localStorage.getItem(WIDTH_KEY)) || 268)
const formOpen = ref(false)
const formTask = ref<TaskDto | null>(null)

let offPush: (() => void) | null = null

onMounted(() => {
  void store.load()
  offPush = store.bindPush()
})
onBeforeUnmount(() => offPush?.())

function openForm(task: TaskDto | null) {
  formTask.value = task
  formOpen.value = true
}

async function onSubmit(input: { name: string; prompt: string; schedule: ScheduleDto }) {
  await store.saveTask(input, formTask.value?.id)
  formOpen.value = false
}

async function onRemove(id: string) {
  if (!confirm('删除任务会同时删除它的运行历史，确定吗？')) return
  await store.remove(id)
}

let startX = 0
let startW = 0
function onMove(e: MouseEvent) {
  const next = Math.min(480, Math.max(200, startW + (e.clientX - startX)))
  listWidth.value = next
}
function onUp() {
  localStorage.setItem(WIDTH_KEY, String(listWidth.value))
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
}
function startResize(e: MouseEvent) {
  startX = e.clientX
  startW = listWidth.value
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
</script>
```
> 样式照设计稿第 2 节：`.tasks-pane { display:flex; height:100% }`、`.empty-detail` 居中提示。

- [ ] **Step 6: HomeView 接入**

在 `HomeView.vue`：

1. 左栏收藏夹按钮（`:52-57`）**之前**插入任务入口：
```vue
        <button v-if="!sidebarCollapsed" class="home-entry tooltip-wrap" @click="openTasksTab">
          <Icon name="alarm-clock" :size="16" />
          <span class="entry-label">任务</span>
          <span class="tooltip">任务</span>
        </button>
```
2. 折叠态（`:80-88` 区域）照 `onCollapsedFav` 的写法加一个折叠态任务入口，点它先展开侧栏再开 tab：
```ts
function onCollapsedTasks() {
  sidebarCollapsed.value = false
  openTasksTab()
}
function openTasksTab() {
  tabsStore.openTasks()
}
```
3. 内容区加 pane（照 `GuideTab` 的 `v-show` 写法）：
```vue
        <div v-show="tabsStore.activeType === 'tasks'" class="pane-fill">
          <TasksPane />
        </div>
```

- [ ] **Step 7: Type check + 手动验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出
Run: `npm run dev`
Expected：左栏出现「任务」（在收藏夹上面）；点它开一个「任务」tab；面板显示空状态「暂无任务」；控制台无报错。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/types/tab.ts src/renderer/src/stores/tabs.ts src/renderer/src/components/GlobalTabs.vue src/renderer/src/components/Icon.vue src/renderer/src/views/HomeView.vue src/renderer/src/components/tasks/TasksPane.vue src/renderer/src/components/tasks/TaskList.vue
git commit -m "feat: 新增任务入口、tab 与任务列表面板"
```

---

## Task 14: 任务详情与运行历史（`TaskDetailPane`）

**Files:**
- Create: `src/renderer/src/components/tasks/TaskDetailPane.vue`

**Interfaces:**
- Consumes: `TaskList` / `TasksPane`（Task 13）、`RunStreamView`（Task 15，**先不写流水，见下面说明**）

- [ ] **Step 1: 写组件**

```vue
<!-- src/renderer/src/components/tasks/TaskDetailPane.vue -->
<template>
  <div class="detail">
    <div class="dhd">
      <h3>{{ task.name }}</h3>
      <button class="btn primary" @click="$emit('run-now', task.id)">
        <Icon name="play" :size="14" />立即执行
      </button>
      <button class="btn ghost" title="编辑" @click="$emit('edit', task)">
        <Icon name="pencil" :size="14" />
      </button>
      <button class="btn ghost" title="删除" @click="$emit('remove', task.id)">
        <Icon name="trash" :size="14" />
      </button>
    </div>

    <div class="dbody">
      <dl class="kv">
        <dt>调度</dt>
        <dd>{{ task.schedule }} <span class="chip mono">{{ rawExpr }}</span></dd>
        <dt>状态</dt>
        <dd>
          <span class="sd" :class="task.enabled ? 'on' : 'off'" />
          {{ task.enabled ? '已启用' : '已停用' }}
        </dd>
        <dt>下次运行</dt>
        <dd>
          <template v-if="task.enabled && task.nextRunAt">
            {{ formatAbs(task.nextRunAt) }} <span class="dim">（{{ formatRelTime(Math.floor(task.nextRunAt / 1000)) }}）</span>
          </template>
          <span v-else class="dim">—</span>
        </dd>
        <dt>上次运行</dt>
        <dd>
          <template v-if="task.lastRunAt">
            {{ formatAbs(task.lastRunAt) }}
            <span :class="lastStatusClass">{{ statusLabel(task.lastStatus) }}</span>
          </template>
          <span v-else class="dim">还没跑过</span>
        </dd>
        <dt>Prompt</dt>
        <dd class="prompt mono">{{ task.prompt }}</dd>
      </dl>

      <div class="sep" />
      <div class="subhd">运行历史</div>

      <div class="runs">
        <div
          v-for="r in runs"
          :key="r.id"
          class="run"
          :class="{ sel: r.id === activeRun?.id }"
          @click="$emit('open-run', r.id)"
        >
          <span class="st" :class="'st-' + r.status">
            <Icon :name="statusIcon(r.status)" :size="12" />{{ statusLabel(r.status) }}
          </span>
          <span class="tg">{{ r.trigger === 'manual' ? '手动' : '自动' }}</span>
          <span class="wh">{{ formatAbs(r.startedAt ?? r.queuedAt) }}</span>
          <span class="ms">{{ runSummaryText(r.resultText, r.error, r.status) }}</span>
          <span class="rt">{{ metaText(r) }}</span>
          <Icon name="chevron-right" :size="12" class="arrow" />
        </div>
        <div v-if="runs.length === 0" class="empty">还没跑过</div>
      </div>
      <div v-if="hasMore" class="more">
        <button class="btn ghost" @click="$emit('load-more')">加载更早的运行记录</button>
      </div>

      <RunStreamView
        v-if="activeRun"
        :run="activeRun"
        :events="events"
        :task-label="task.name"
        @cancel="$emit('cancel', activeRun.id)"
        @close="$emit('close-run')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '../Icon.vue'
import RunStreamView from './RunStreamView.vue'
import { runSummaryText } from '../../utils/tasks'
import { formatRelTime } from '../../utils/time'
import type { EventEnvelope, RunDto, TaskDto } from '../../types/tasks'

defineProps<{
  task: TaskDto
  runs: RunDto[]
  hasMore: boolean
  activeRun: RunDto | null
  events: EventEnvelope[]
}>()
defineEmits<{
  (e: 'edit', task: TaskDto): void
  (e: 'remove', id: string): void
  (e: 'run-now', id: string): void
  (e: 'load-more'): void
  (e: 'open-run', runId: string): void
  (e: 'cancel', runId: string): void
  /** 运行流水返回按钮：收起流水、回到运行历史 */
  (e: 'close-run'): void
}>()

const LABELS: Record<string, string> = {
  queued: '排队中', running: '运行中', done: '成功', error: '失败',
  timeout: '超时', skipped: '已跳过', interrupted: '已中断',
}
const ICONS: Record<string, string> = {
  queued: 'clock', running: 'loader', done: 'check', error: 'alert',
  timeout: 'clock', skipped: 'slash', interrupted: 'slash',
}

const rawExpr = (task: TaskDto) => task.scheduleRaw.type === 'cron' ? task.scheduleRaw.expression : formatAbs(task.scheduleRaw.runAt)
const statusLabel = (s: string | null) => (s ? LABELS[s] ?? s : '—')
const statusIcon = (s: string) => ICONS[s] ?? 'clock'

function lastStatusClass(t: TaskDto): string {
  if (t.lastStatus === 'done') return 'st-done'
  if (t.lastStatus && ['error', 'timeout', 'interrupted'].includes(t.lastStatus)) return 'st-error'
  return 'dim'
}

function formatAbs(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function metaText(r: RunDto): string {
  if (r.status === 'queued' || r.status === 'running') return '—'
  const bits: string[] = []
  if (r.durationMs != null) bits.push(`${(r.durationMs / 1000).toFixed(1)}s`)
  if (r.numTurns != null) bits.push(`${r.numTurns} 轮`)
  if (r.totalCostUsd != null) bits.push(`$${r.totalCostUsd.toFixed(3)}`)
  return bits.join(' · ') || '—'
}
</script>
```
> 注意 `rawExpr` 是模板里调用的函数而不是变量，若 `vue-tsc` 报模板作用域问题，改成 `computed`。样式照设计稿第 2 节右栏的 `.detail / .dhd / .dbody / .kv / .chip / .sep / .subhd / .runs / .run / .st-* / .more`。

- [ ] **Step 2: Type check**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 需要先建 Task 15 的 `RunStreamView.vue` 才能通过——**若 `RunStreamView` 尚不存在，先建一个最小占位组件**（`<template><div class="stream" /></template>`），Task 15 再替换成真实实现。这样本 task 可以独立提交。

- [ ] **Step 3: 手动验证**

Run: `npm run dev`
Expected：新建一个任务后，右栏显示调度/状态/下次运行/Prompt；执行一次（`立即执行`）后运行历史出现一行，状态从「运行中」变为「成功」。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/tasks/TaskDetailPane.vue src/renderer/src/components/tasks/RunStreamView.vue
git commit -m "feat: 新增任务详情与运行历史面板"
```

---

## Task 15: 运行流水渲染（`RunStreamView` + `ToolStepCard`）

**Files:**
- Create/Modify: `src/renderer/src/components/tasks/RunStreamView.vue`（替换 Task 14 的占位）
- Create: `src/renderer/src/components/tasks/ToolStepCard.vue`

**Interfaces:**
- Consumes: `flattenRunEvents` / `toolSummary`（Task 11）、设计稿第 3 / 4 节

- [ ] **Step 1: 写 `ToolStepCard.vue`**

```vue
<!-- src/renderer/src/components/tasks/ToolStepCard.vue -->
<template>
  <div class="step-wrap" :class="{ err: item.status === 'error' }" :style="{ borderLeftColor: hueColor(item.id) }">
    <div class="step" @click="open = !open">
      <Icon :name="open ? 'chevron-down' : 'chevron-right'" :size="12" class="cv" />
      <span class="tname">{{ item.name }}</span>
      <span class="summ">{{ item.summary }}</span>
      <span v-if="item.delta" class="delta">
        <span class="diff-add">+{{ item.delta.add }}</span>
        <span class="diff-del">−{{ item.delta.del }}</span>
      </span>
      <span class="stt" :class="'st-' + item.status">
        <Icon :name="statusIcon" :size="12" />{{ statusLabel }}
      </span>
    </div>
    <div v-if="open" class="open">
      <div v-if="!hideInput" class="io"><pre>{{ inputText }}</pre></div>
      <div v-if="item.output !== undefined && !hideOutput" class="io">
        <pre v-if="isDiff" v-html="diffHtml" />
        <pre v-else>{{ item.output }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../Icon.vue'
import { hueColor } from '../../composables/useIdHue'
import type { StreamItem } from '../../types/tasks'

const props = defineProps<{
  item: Extract<StreamItem, { kind: 'tool' }>
  hideInput: boolean
  hideOutput: boolean
}>()

const STATUS: Record<string, { icon: string; label: string }> = {
  ok: { icon: 'check', label: '成功' },
  error: { icon: 'alert', label: '失败' },
  running: { icon: 'loader', label: '运行中' },
}

/** Edit / Write 的 diff 是任务的核心产出 → 默认展开 */
const isDiffTool = computed(() => props.item.name === 'Edit' || props.item.name === 'Write')
const open = ref(isDiffTool.value)
const statusIcon = computed(() => STATUS[props.item.status]?.icon ?? 'clock')
const statusLabel = computed(() => STATUS[props.item.status]?.label ?? props.item.status)
const inputText = computed(() => JSON.stringify(props.item.input, null, 2))
const isDiff = computed(() => isDiffTool.value && typeof props.item.output === 'string')

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const diffHtml = computed(() => {
  const raw = props.item.input
  const oldS = typeof raw.old_string === 'string' ? raw.old_string : ''
  const newS = typeof raw.new_string === 'string' ? raw.new_string : ''
  const del = oldS ? oldS.split('\n').map((l) => `<span class="diff-del">−${esc(l)}</span>`).join('\n') : ''
  const add = newS ? newS.split('\n').map((l) => `<span class="diff-add">+${esc(l)}</span>`).join('\n') : ''
  if (oldS || newS) return [del, add].filter(Boolean).join('\n')
  return esc(typeof props.item.input.content === 'string' ? props.item.input.content : '')
})
</script>
```
> 样式照设计稿第 3 节的 `.step-wrap / .step / .cv / .tname / .summ / .stt / .delta / .open / .io`，以及 `.diff-add / .diff-del`。

- [ ] **Step 2: 写 `RunStreamView.vue`**

```vue
<!-- src/renderer/src/components/tasks/RunStreamView.vue -->
<template>
  <div class="stream">
    <div class="shd">
      <span class="bk" @click="$emit('close')">
        <Icon name="chevron-left" :size="14" />{{ taskLabel }}
      </span>
      <span class="dim">/</span>
      <span class="ttl">{{ startedText }} 的运行</span>
    </div>

    <!-- 按元素显隐开关（照 @fnclaude/renderer 的做法，切换即时重绘） -->
    <div class="toggles">
      <span class="tg" :class="{ on: show.thinking }" @click="show.thinking = !show.thinking">思考</span>
      <span class="tg" :class="{ on: show.input }" @click="show.input = !show.input">工具入参</span>
      <span class="tg" :class="{ on: show.output }" @click="show.output = !show.output">工具输出</span>
      <span class="tg" :class="{ on: show.errorsOnly }" @click="show.errorsOnly = !show.errorsOnly">仅错误</span>
      <span class="sp" />
      <span class="cnt">{{ events.length }} 条事件 · {{ toolCount }} 个工具调用 · {{ errorCount }} 个失败</span>
    </div>

    <div class="sbar" :class="run.status === 'running' ? 'live' : (isBad ? 'err' : '')">
      <Icon :name="barIcon" :size="14" :class="'st-' + run.status" />
      <span class="big" :class="'st-' + run.status">{{ barLabel }}</span>
      <span class="muted">{{ barMeta }}</span>
      <span v-if="run.status === 'running'" style="margin-left:auto">
        <button class="btn" @click="$emit('cancel')">取消</button>
      </span>
    </div>

    <div ref="bodyEl" class="sbody" @scroll="onScroll">
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item.kind === 'init'" class="meta-line">
          <span>Claude Code {{ item.version }}</span>
          <span class="dim">·</span>
          <span>{{ item.model }}</span>
          <span class="dim">·</span>
          <span class="mono">{{ shortCwd(item.cwd) }}</span>
          <span class="dim">·</span>
          <span>{{ item.toolCount }} 个工具</span>
          <span v-for="m in item.failedMcpServers" :key="m" class="warnchip">
            <Icon name="alert" :size="12" />MCP {{ m }} 连接失败
          </span>
        </div>

        <div v-else-if="item.kind === 'hook'" class="hooked">
          <Icon name="hook" :size="12" />
          {{ item.name }} · {{ item.ok ? '成功' : '失败' }}
        </div>

        <div v-else-if="item.kind === 'thinking'" class="fold-block">
          <div class="fold" @click="toggleFold(i)">
            <Icon :name="folded.has(i) ? 'chevron-right' : 'chevron-down'" :size="12" />思考
          </div>
          <div v-if="!folded.has(i)" class="md-text">{{ item.text }}</div>
        </div>

        <Markdown v-else-if="item.kind === 'text'" :text="item.text" class="md-text" />

        <ToolStepCard
          v-else-if="item.kind === 'tool'"
          :item="item"
          :hide-input="!show.input"
          :hide-output="!show.output"
        />

        <div v-else-if="item.kind === 'stderr'" class="fold-block">
          <div class="fold" @click="toggleFold(i)">
            <Icon :name="folded.has(i) ? 'chevron-right' : 'chevron-down'" :size="12" />诊断输出
          </div>
          <div v-if="!folded.has(i)" class="io"><pre>{{ item.text }}</pre></div>
        </div>

        <div v-else-if="item.kind === 'result'" class="res" :class="{ err: item.summary.isError }">
          <div class="rh">
            <Icon :name="item.summary.isError ? 'alert' : 'check'" :size="14" :class="item.summary.isError ? 'st-error' : 'st-done'" />
            <span class="big" :class="item.summary.isError ? 'st-error' : 'st-done'">
              {{ item.summary.isError ? '失败' : '成功' }}
            </span>
            <span>
              {{ item.summary.numTurns }} 轮 · {{ (item.summary.durationMs / 1000).toFixed(1) }}s ·
              ${{ item.summary.totalCostUsd.toFixed(3) }}
              <template v-if="item.summary.stopReason">· stop_reason={{ item.summary.stopReason }}</template>
            </span>
            <span v-if="usageChips(item.summary.usage)" class="chip">{{ usageChips(item.summary.usage) }}</span>
          </div>
          <div class="rt">{{ item.summary.resultText || '（无输出）' }}</div>
        </div>
      </template>

      <div v-if="run.status === 'running'" class="follow-caret"><span class="caret" /></div>
      <div v-if="items.length === 0" class="empty">这次运行还没有事件</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import Markdown from '../Markdown.vue'
import ToolStepCard from './ToolStepCard.vue'
import { flattenRunEvents } from '../../utils/tasks'
import type { EventEnvelope, RunDto, StreamItem } from '../../types/tasks'

const props = defineProps<{
  run: RunDto
  events: EventEnvelope[]
  taskLabel?: string
}>()
defineEmits<{ (e: 'cancel'): void; (e: 'close'): void }>()

const show = ref({ thinking: true, input: false, output: true, errorsOnly: false })
const folded = ref<Set<number>>(new Set())
const bodyEl = ref<HTMLElement | null>(null)
let following = true

const all = computed(() => flattenRunEvents(props.events))

const items = computed<StreamItem[]>(() => {
  let list = all.value
  if (!show.value.thinking) list = list.filter((i) => i.kind !== 'thinking')
  if (show.value.errorsOnly) {
    list = list.filter((i) => i.kind === 'result' ? i.summary.isError : (i.kind !== 'tool' || i.status === 'error'))
  }
  return list
})

const toolCount = computed(() => all.value.filter((i) => i.kind === 'tool').length)
const errorCount = computed(() =>
  all.value.filter((i) => i.kind === 'tool' && i.status === 'error').length,
)

const isBad = computed(() => ['error', 'timeout', 'interrupted'].includes(props.run.status))
const LABELS: Record<string, string> = {
  queued: '排队中', running: '运行中', done: '成功', error: '失败',
  timeout: '超时', skipped: '已跳过', interrupted: '已中断',
}
const ICONS: Record<string, string> = {
  queued: 'clock', running: 'loader', done: 'check', error: 'alert',
  timeout: 'clock', skipped: 'slash', interrupted: 'slash',
}
const barLabel = computed(() => LABELS[props.run.status] ?? props.run.status)
const barIcon = computed(() => ICONS[props.run.status] ?? 'clock')

const startedText = computed(() => {
  const ms = props.run.startedAt ?? props.run.queuedAt
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

const barMeta = computed(() => {
  const bits: string[] = []
  if (props.run.status === 'running' && props.run.startedAt) {
    bits.push(`已 ${((Date.now() - props.run.startedAt) / 1000).toFixed(0)}s`)
  }
  if (props.run.numTurns != null) bits.push(`${props.run.numTurns} 轮`)
  if (props.run.totalCostUsd != null) bits.push(`$${props.run.totalCostUsd.toFixed(3)}`)
  if (props.run.resultSubtype && props.run.status === 'error') bits.push(props.run.resultSubtype)
  if (props.run.resumeUsed === 0) bits.push('会话已重建')
  return bits.join(' · ')
})

function toggleFold(i: number) {
  const next = new Set(folded.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  folded.value = next
}

function shortCwd(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…\\${parts.slice(-2).join('\\')}` : cwd
}

function usageChips(usage: Record<string, number>): string {
  const LABELS: Record<string, string> = {
    input_tokens: 'in', output_tokens: 'out',
    cache_read_input_tokens: 'cache_read', cache_creation_input_tokens: 'cache_write',
  }
  return Object.entries(usage)
    .map(([k, v]) => `${LABELS[k] ?? k} ${v.toLocaleString()}`)
    .join(' · ')
}

function onScroll() {
  const el = bodyEl.value
  if (!el) return
  following = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

watch(
  () => props.events.length,
  async () => {
    if (!following || !bodyEl.value) return
    await nextTick()
    bodyEl.value.scrollTop = bodyEl.value.scrollHeight
  },
)
</script>
```
> 样式照设计稿第 3 / 4 节的 `.stream / .shd / .toggles / .tg / .sbar / .sbody / .meta-line / .hooked / .fold-block / .md-text / .io / .res / .caret / .empty`。

- [ ] **Step 3: Type check + 手动端到端验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出

Run: `npm run dev`，然后：
1. 新建任务，prompt 写 `运行 ls -la 并告诉我文件数`，调度选「每 5 分钟」
2. 点「立即执行」
3. 等 10~30 秒
Expected：运行历史出现一行并变为「成功」；点它打开流水，看到 init 行、思考折叠块、文本、Bash StepCard（点开有 `ls -la` 输出）、终局卡片带轮数/耗时/成本/token 明细。切「仅错误」开关只留失败项。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/tasks/RunStreamView.vue src/renderer/src/components/tasks/ToolStepCard.vue
git commit -m "feat: 新增运行流水渲染与工具折叠卡片"
```

---

## Task 16: 新建 / 编辑表单与设置项

**Files:**
- Create: `src/renderer/src/components/tasks/TaskFormDialog.vue`
- Modify: `src/renderer/src/components/Icon.vue`（若 `alert` 等仍未注册则补）

**Interfaces:**
- Consumes: `useTasksStore.preview`（Task 12）、`presetToCron` 的**前端等价实现**（见下）

- [ ] **Step 1: 写组件**

```vue
<!-- src/renderer/src/components/tasks/TaskFormDialog.vue -->
<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="dlg">
      <div class="dlg-hd">
        {{ task ? '编辑任务' : '新建任务' }}
        <span class="x" @click="$emit('close')"><Icon name="x" :size="16" /></span>
      </div>

      <div class="dlg-bd">
        <div class="fld">
          <label>名称</label>
          <div class="ctl"><input v-model="name" class="inp" placeholder="每日 CI 失败巡检" /></div>
        </div>

        <div class="fld">
          <label>Prompt</label>
          <div class="ctl" style="flex-direction:column;gap:6px">
            <textarea v-model="prompt" class="inp" placeholder="检查最近的 CI 失败，定位原因并修复，完成后提交并推送。" />
            <div class="hint">
              <Icon name="alert" :size="12" />
              任务在固定的任务目录（<span class="mono">~/.lynel-desktop/tasks/</span>）中运行；要操作其他项目请在 prompt 里写绝对路径。
            </div>
          </div>
        </div>

        <div class="fld">
          <label>调度</label>
          <div class="ctl" style="flex-direction:column;gap:10px">
            <div class="radios">
              <span
                v-for="p in PRESETS"
                :key="p.kind"
                class="radio"
                :class="{ on: preset.kind === p.kind }"
                @click="pickPreset(p.kind)"
              ><span class="dot2" />{{ p.label }}</span>
            </div>

            <!-- 预设参数 -->
            <div v-if="preset.kind === 'weekly'" class="ctl" style="flex-wrap:wrap;gap:6px">
              <span
                v-for="(d, i) in WEEKDAYS"
                :key="d.value"
                class="radio"
                :class="{ on: (preset.weekdays ?? []).includes(d.value) }"
                @click="toggleWeekday(d.value)"
              >{{ WEEKDAYS_CN[i] }}</span>
            </div>
            <div v-if="preset.kind === 'monthly'" class="ctl" style="align-items:center">
              <span class="dim small">每月</span>
              <input v-model.number="preset.dayOfMonth" class="inp mono" style="width:56px;text-align:center" type="number" min="1" max="31" />
              <span class="dim small">号</span>
            </div>
            <div v-if="preset.kind === 'everyNMinutes'" class="ctl" style="align-items:center">
              <span class="dim small">每</span>
              <input v-model.number="preset.everyMinutes" class="inp mono" style="width:56px;text-align:center" type="number" min="1" max="59" />
              <span class="dim small">分钟</span>
            </div>

            <!-- 时间 / 日期时间 -->
            <div v-if="needsTime" class="ctl" style="align-items:center">
              <span class="dim small">{{ preset.kind === 'hourly' ? '第' : '' }}</span>
              <input
                v-if="preset.kind === 'hourly'"
                v-model.number="preset.minute"
                class="inp mono" style="width:56px;text-align:center" type="number" min="0" max="59"
              />
              <template v-else>
                <input v-model.number="preset.hour" class="inp mono" style="width:56px;text-align:center" type="number" min="0" max="23" />
                <span class="dim">:</span>
                <input v-model.number="preset.minute" class="inp mono" style="width:56px;text-align:center" type="number" min="0" max="59" />
              </template>
              <span v-if="preset.kind === 'hourly'" class="dim small">分钟</span>
            </div>

            <div v-if="preset.kind === 'once'" class="ctl" style="align-items:center">
              <input v-model="onceLocal" class="inp mono" type="datetime-local" />
            </div>

            <!-- 表达式（预设自动回填，也可手改） -->
            <div class="ctl" style="align-items:center">
              <span class="dim small" style="width:34px">表达式</span>
              <input
                :value="expression"
                class="inp mono"
                :class="{ bad: exprError }"
                :disabled="preset.kind === 'once'"
                @input="onExprInput"
              />
            </div>

            <div class="preview">
              <div class="ph">接下来 3 次运行</div>
              <div v-if="nextRuns.length" class="pl">
                <span v-for="n in nextRuns" :key="n">{{ fmt(n) }}</span>
              </div>
              <div v-else class="pl dim">{{ exprError || '—' }}</div>
            </div>
          </div>
        </div>

        <div class="warn">
          <Icon name="alert" :size="14" />
          <span>定时任务无人值守运行，将以完全权限执行（<span class="mono">bypassPermissions</span>），请确认任务内容可信。</span>
        </div>
      </div>

      <div class="dlg-ft">
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="!canSubmit" @click="submit">
          {{ task ? '保存' : '创建任务' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import { useTasksStore } from '../../stores/tasks'
import type { ScheduleDto, TaskDto } from '../../types/tasks'

const props = defineProps<{ task: TaskDto | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', input: { name: string; prompt: string; schedule: ScheduleDto }): void
}>()

const store = useTasksStore()

type Kind = 'daily' | 'weekly' | 'monthly' | 'hourly' | 'everyNMinutes' | 'once' | 'custom'
const PRESETS: Array<{ kind: Kind; label: string }> = [
  { kind: 'daily', label: '每天' }, { kind: 'weekly', label: '每周' },
  { kind: 'monthly', label: '每月' }, { kind: 'hourly', label: '每小时' },
  { kind: 'everyNMinutes', label: '每 N 分钟' }, { kind: 'once', label: '一次性' },
  { kind: 'custom', label: '自定义 cron' },
]
const WEEKDAYS = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }, { value: 6 }, { value: 0 }]
const WEEKDAYS_CN = ['一', '二', '三', '四', '五', '六', '日']

const name = ref(props.task?.name ?? '')
const prompt = ref(props.task?.prompt ?? '')
const preset = ref<{
  kind: Kind; hour: number; minute: number; weekdays: number[];
  dayOfMonth: number; everyMinutes: number;
}>({ kind: 'daily', hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5], dayOfMonth: 1, everyMinutes: 30 })
const onceLocal = ref('')
const manualExpr = ref<string | null>(null)
const nextRuns = ref<number[]>([])
const exprError = ref('')

/** 预设 → 表达式。与主进程 schedule.ts 的 presetToCron 同一套模板（前端不能 import 主进程模块）。 */
function buildExpr(): string | null {
  const p = preset.value
  const pad = (n: number) => String(n).padStart(2, '0')
  switch (p.kind) {
    case 'daily': return `${p.minute} ${p.hour} * * *`
    case 'weekly': {
      if (p.weekdays.length === 0) return null
      return `${p.minute} ${p.hour} * * ${[...p.weekdays].sort((a, b) => a - b).join(',')}`
    }
    case 'monthly': return `${p.minute} ${p.hour} ${p.dayOfMonth} * *`
    case 'hourly': return `${p.minute} * * * *`
    case 'everyNMinutes': return p.everyMinutes >= 1 && p.everyMinutes <= 59 ? `*/${p.everyMinutes} * * * *` : null
    case 'custom': return manualExpr.value && manualExpr.value.trim() ? manualExpr.value.trim() : null
    default: return null
  }
}

const expression = computed(() => {
  if (preset.value.kind === 'once') return ''
  if (manualExpr.value !== null) return manualExpr.value
  return buildExpr() ?? ''
})

/** 表达式 → 预设反查（模板精确匹配），用于「编辑已有任务」回填 */
function detectPreset(expr: string): Kind {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return 'custom'
  const [mi, ho, dom, mon, dow] = parts
  const isNum = (s: string) => /^\d+$/.test(s)
  if (mi.startsWith('*/') && isNum(mi.slice(2)) && ho === '*' && dom === '*' && mon === '*' && dow === '*') return 'everyNMinutes'
  if (isNum(mi) && ho === '*' && dom === '*' && mon === '*' && dow === '*') return 'hourly'
  if (!isNum(mi) || !isNum(ho)) return 'custom'
  if (isNum(dom) && mon === '*' && dow === '*') return 'monthly'
  if (dom === '*' && mon === '*' && dow !== '*' && dow.split(',').every(isNum)) return 'weekly'
  if (dom === '*' && mon === '*' && dow === '*') return 'daily'
  return 'custom'
}

function applyExprToPreset(expr: string) {
  const kind = detectPreset(expr)
  const parts = expr.trim().split(/\s+/)
  if (kind === 'custom' || parts.length !== 5) {
    preset.value = { ...preset.value, kind: 'custom' }
    manualExpr.value = expr
    return
  }
  const [mi, ho, dom, dow] = parts
  preset.value = {
    ...preset.value,
    kind,
    minute: kind === 'hourly' || kind === 'everyNMinutes' ? Number(mi.startsWith('*/') ? 0 : mi) : Number(mi),
    hour: ho === '*' ? preset.value.hour : Number(ho),
    dayOfMonth: kind === 'monthly' ? Number(dom) : preset.value.dayOfMonth,
    weekdays: kind === 'weekly' ? dow.split(',').map(Number) : preset.value.weekdays,
    everyMinutes: kind === 'everyNMinutes' ? Number(mi.slice(2)) : preset.value.everyMinutes,
  }
  manualExpr.value = null
}

const needsTime = computed(() => ['daily', 'weekly', 'monthly', 'hourly'].includes(preset.value.kind))
const canSubmit = computed(() => {
  if (!name.value.trim() || !prompt.value.trim()) return false
  if (preset.value.kind === 'once') return onceLocal.value !== ''
  return expression.value !== '' && !exprError.value
})

function pickPreset(kind: Kind) {
  preset.value = { ...preset.value, kind }
  manualExpr.value = null
}
function toggleWeekday(d: number) {
  const cur = preset.value.weekdays
  preset.value = { ...preset.value, weekdays: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d] }
}
function onExprInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  manualExpr.value = v
  const detected = detectPreset(v)
  if (detected !== 'custom') {
    // 手改后若命中模板，同步刷新预设表单，让控件跟着动
    applyExprToPreset(v)
  } else {
    preset.value = { ...preset.value, kind: 'custom' }
  }
}

function scheduleDto(): ScheduleDto {
  if (preset.value.kind === 'once') {
    return { type: 'once', runAt: new Date(onceLocal.value).getTime() }
  }
  return { type: 'cron', expression: expression.value }
}

function fmt(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`
  return sameDay ? `今天 ${time}` : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`
}

async function refreshPreview() {
  exprError.value = ''
  nextRuns.value = []
  if (preset.value.kind === 'once') {
    if (onceLocal.value) nextRuns.value = [new Date(onceLocal.value).getTime()]
    return
  }
  const expr = expression.value
  if (!expr) return
  try {
    nextRuns.value = await store.preview({ type: 'cron', expression: expr })
    if (nextRuns.value.length === 0) exprError.value = '表达式无法解析出下一次运行时间'
  } catch {
    exprError.value = '表达式非法'
  }
}

function submit() {
  emit('submit', { name: name.value.trim(), prompt: prompt.value, schedule: scheduleDto() })
}

onMounted(() => {
  const raw = props.task?.scheduleRaw
  if (raw?.type === 'once') {
    const d = new Date(raw.runAt)
    const p = (n: number) => String(n).padStart(2, '0')
    onceLocal.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
    preset.value = { ...preset.value, kind: 'once' }
  } else if (raw?.type === 'cron') {
    applyExprToPreset(raw.expression)
  }
  void refreshPreview()
})

watch([preset, expression, onceLocal], () => void refreshPreview(), { deep: true })
</script>
```
> 样式照设计稿第 5 节的 `.overlay / .dlg / .dlg-hd / .dlg-bd / .fld / .radios / .radio / .dot2 / .preview / .warn / .hint / .dlg-ft`；`.inp.bad` 用 `border-color: var(--status-error)`。

- [ ] **Step 2: 加设置项 `tasks_max_concurrency` 与 `tasks_dir`**

在 `src/renderer/src/components/settings/GeneralTab.vue`（或该功能所在的设置页）里，照现有设置项的写法加两个字段：并发上限（数字，默认 6）、任务目录（文本，默认留空 = `~/.lynel-desktop/tasks/`）。键名分别 `tasks_max_concurrency` / `tasks_dir`，走现有的设置读写链路（`stores/settings.ts` + 主进程 settings store）。若现有设置项有分组结构，放进「通用」组。

- [ ] **Step 3: Type check + 手动验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无输出

Run: `npm run dev`
1. 点「新建任务」→ 表单出现，默认预设「每天 09:00」，预览显示接下来 3 次运行时间
2. 切「每 N 分钟」→ 表达式自动变 `*/N * * * *`，预览刷新
3. 手改表达式为 `0 0 1 1 *` → 预设跳到「自定义」，预览正常
4. 手改为一个非法表达式（如 `99 99 * * *`）→ 预览区显示错误、表达式框标红、「创建任务」禁用
5. 保存 → 列表出现新任务；重新打开编辑 → 预设正确回填

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/tasks/TaskFormDialog.vue src/renderer/src/components/settings/GeneralTab.vue
git commit -m "feat: 新增任务表单与调度设置项"
```

---

## 最终验收（全部 task 完成后）

- [ ] `npm run test:main` 全绿
- [ ] `cd src/renderer && npx vue-tsc --noEmit` 无输出
- [ ] `npm run build` 成功
- [ ] 端到端手工验证一遍 spec §8 的全部 UI 行为：

| 验证项 | 期望 |
|---|---|
| 左栏入口位置 | 「任务」在收藏夹上面；折叠态点它先展开再开 tab |
| 任务会话不出现在会话列表 | 跑完一个任务后，左栏会话列表**没有**新增条目；`watchProjects` 也不触发列表刷新 |
| 定时触发 | 建一个「每 2 分钟」的任务，等 2 分钟，出现一条 `自动` 的 run |
| 手动执行 | 点「立即执行」出现 `手动` 的 run，且任务的「下次运行」**不变** |
| once 收尾 | 建一个一次性任务跑完 → `enabled` 变停用、任务仍在、历史保留 |
| 超窗 miss | 把 `tasks_dir` 指向一个已有任务的目录后手工把 `next_run_at` 改到 2 小时前 → tick 后 `last_status=missed` |
| 单任务去重 | 任务执行期间下一个 tick 不产生第二个 run |
| 失败通知 | 故意把 prompt 写成一个必然失败的场景（例如 resume 一个被删的会话目录），确认弹了系统通知且成功时不弹 |
| 会话复用 | 同一任务第二次执行时请求里带 `--resume`（看 run 详情里的 `resumeUsed`），上下文延续 |
| resume 自愈 | 删掉 `~/.claude/projects/<tasks-encoded>/<sid>.jsonl` 后执行该任务 → 自动重建会话，run 上 `会话已重建` 标记 |
| App 退出清理 | 任务运行中直接退出 App → 重启后该 run 显示「已中断」，没有遗留 claude 进程 |
- [ ] 更新 `CLAUDE.md` 的架构要点：新增第 17 节描述 `src/main/tasks/`（与现有「16. Git 面板与文件工作区」同风格），并在「重要不变量」里补三条：所有任务共用一个固定 cwd；任务会话必须从会话扫描中排除；`node:sqlite` 是唯一 DB 接触点。
- [ ] 更新 `README.md` 的目录结构表（若其中有主进程模块清单）。

---

## Self-Review 记录

**Spec 覆盖检查：**

| Spec 章节 | 对应 task |
|---|---|
| D1 直连全局配置 | Task 10（不注入 `--settings`；`runner.ts` 只删 `CLAUDECODE`） |
| D2 流粒度（不加 partial） | Task 8（`buildSpawnArgs` 不带 `--include-partial-messages`） |
| D3 预设 + 自定义 cron | Task 5（`presetToCron` / `cronToPreset`）+ Task 16（表单互填） |
| D4 `bypassPermissions` + 警示 | Task 8（flag）+ Task 16（`.warn` 行） |
| D5 一任务一会话 | Task 8（`--session-id` → `--resume` + `adoptSessionAfterFirstSuccess`） |
| D6 队列 + 并发上限 + 排队超时 | Task 9（`drain` / `queue` / `QUEUE_TIMEOUT_MS`） |
| D7 不重试 + 30 分钟超时 | Task 8（`RUN_TIMEOUT_MS` timer）+ Task 9（失败后照常推进 `nextRunAt`） |
| D8 补跑窗口 60 分钟 | Task 6（`CATCH_UP_MS` + `isDue`）+ Task 9（`tick` 的 missed 分支） |
| D9 只支持 claude | Task 8（参数写死 claude 形状；`agent` 字段保留但不选择） |
| D10 固定 tasks 目录、schema 无 workdir | Task 1（`paths.ts`）+ Task 2（schema）+ Task 8（`cwd: ensureTasksDir()`） |
| D11 jsonl 隔离 | Task 10（`setExcludedProjects` + `scanAll` + `watchProjects`） |
| D12 失败通知 | Task 9（`setSchedulerNotify` 过滤失败态）+ Task 10（接 `attention`） |
| §3 三表 | Task 2 |
| §5.1 spawn 参数 / §5.2 消费 / §5.3 终态 / §5.4 resume 回退 / §5.5 隔离 | Task 8 / Task 8 / Task 8 / Task 8 / Task 10 |
| §6 调度器（tick / 恢复 / 并发） | Task 9 |
| §7 IPC 12 个 handler | Task 10（`index.ts`）+ Task 12（封装） |
| §8.4 C1–C5 数据契约 | Task 7（解析）+ Task 11（折叠） |
| §8.5 StepCard / 显隐开关 / 子代理 / Usage 白名单 | Task 11 / Task 15 |
| §8.6 表单 + 实时预览 + 警示 | Task 16 |
| §9 生命周期（启动顺序 / shutdown） | Task 10（Step 6/7 明确了启动三步顺序） |
| §10 依赖与配置 | Task 5（croner）+ Task 16 Step 2（两个设置项） |
| §11 文件清单 | 全部 task 的 Files 段 |
| §12 R1–R8 | R1/R2/R3/R4/R5 已在实现前实测消除并写进 Global Constraints 速查表；R6/R7 保留为待验证（Task 8 的行为已按最坏情况写：多 agent 交错由 `parentToolUseId` 缩进、重复行由「按行落库 + 前端按 id 配对」天然容忍）；R8 由 `db.ts` 单点隔离兜底 |
| §13 不做项 | 计划里未引入任何 §13 排除的机制 |

**类型一致性检查：** `TaskRow`/`RunRow` 字段名在 Task 3/4 定义、Task 8/9/10 使用，一致；`Schedule` 在 Task 5 定义、Task 9/10 使用，一致；`NormalizedEvent` 在 Task 7 定义、Task 8 消费、Task 10 透出、Task 11 折叠，一致；`StreamItem` 在 Task 11 定义、Task 15 渲染，一致。`toolSummary` 在 Task 11 定义并在同一 task 内测试。

**已知的实现期注意点（已写进对应 step 的注释）：** `node:sqlite` 的 `run()` 返回的 `changes` 是 `number | bigint`，比较前要 `Number()`；`runner.ts` 的首次成功后必须把 `session_initialized` 置 1，否则下次会拿已存在的 id 去「新建」；`TaskList.vue` 里的批量启停要收敛成单个 `defineEmits` 实现。
