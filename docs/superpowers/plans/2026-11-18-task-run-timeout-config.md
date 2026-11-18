# 定时任务运行超时可配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让定时任务的单次运行超时可配置 —— 全局默认值（设置 → 定时任务）+ 每任务覆盖（任务表单），预设 15m/30m/1h/8h/24h + 自定义（1 分钟 ~ 7 天）。

**Architecture:** `tasks` 表加 `timeout_ms` 列（NULL = 跟随全局），schema v2 → v3 走 `addColumn()` 迁移；全局默认存设置键 `tasks_run_timeout_ms`。`runner.startRun` 用纯函数 `resolveRunTimeout(任务值, 全局值)`（无效值逐档回退到 `RUN_TIMEOUT_MS`）决定 timer 时长并生成动态超时文案。渲染层新增共享控件 `TimeoutPicker.vue`（设置页与任务表单两处复用），详情页 chips 仅在任务覆盖时显示超时。

**Tech Stack:** Electron 主进程 TypeScript + node:sqlite；渲染层 Vue 3 + Pinia + vitest/@vue/test-utils（jsdom）；主进程测试 vitest（`tests/main/`）。

**Spec:** `docs/superpowers/specs/2026-11-18-task-run-timeout-config-design.md`

## Global Constraints

- 所有代码注释、commit message 用简体中文。
- commit 格式：`<type>: <subject>`（type ∈ feat/fix/refactor/test/docs/chore/ci）；一个 task 一个 commit。
- 每次 commit 前必须：设置 local git identity（`git config user.name "<name>"; git config user.email "<email>"`），且 `npm run test:main` 与 `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 不提交构建产物（dist/、dist-electron/、.vsix 等）。
- 主进程与渲染进程是两个 bundle，**不能互 import**；超时时长格式化两边各有一小份实现（已接受的重复）。
- 数值边界（与 spec 一致）：默认 30 分钟（1800000ms）；预设 15m/30m/1h/8h/24h；自定义最小 1 分钟（60000ms）、最大 7 天（604800000ms）。
- `QUEUE_TIMEOUT_MS`（排队 30 分钟）与 `CATCH_UP_MS` **不动**。
- 图标只用 `Icon.vue` `icons` 映射里已注册的键；本计划用 `alarm-clock`、`clock`（均已注册）。
- 渲染层测试命令 `cd src/renderer && npx vitest run`；主进程测试 `npm run test:main`（只跑 tests/main）。
- `Pinia ref<Record<K, V>>` 更新用整体 spread；错误返回不抛未捕获异常（本计划不涉及）。
- 渲染层组件用 `<script setup lang="ts">`；样式用 `styles/theme.css` 的 CSS 变量，不硬编码颜色。

## File Structure

| 文件 | 动作 | 职责 |
|------|------|------|
| `src/main/tasks/db.ts` | 修改 | schema v3：`timeout_ms` 列迁移 |
| `src/main/tasks/store.ts` | 修改 | `TaskRow`/`TaskPatch`/`CreateTaskInput` 加 `timeoutMs`，CRUD 读写 |
| `src/main/tasks/schedule.ts` | 修改 | 纯函数 `resolveRunTimeout` / `formatTimeoutLabel` + 边界常量 |
| `src/main/tasks/runner.ts` | 修改 | `startRun` 动态超时 + 动态文案；`RunnerDeps.readGlobalTimeout` |
| `src/main/tasks/index.ts` | 修改 | `tasks:create`/`tasks:update` 透传 `timeoutMs`；timeout 兜底文案 |
| `src/renderer/src/types/settings.ts` | 修改 | `tasks_run_timeout_ms: number` |
| `src/renderer/src/stores/settings.ts` | 修改 | 默认值 1800000 |
| `src/renderer/src/types/tasks.ts` | 修改 | `TaskDto.timeoutMs: number \| null` |
| `src/renderer/src/utils/tasks.ts` | 修改 | 渲染层 `timeoutLabel(ms)` |
| `src/renderer/src/components/TimeoutPicker.vue` | 新建 | 超时选择器共享控件（预设 + 自定义，可选「默认」档） |
| `src/renderer/src/components/TimeoutPicker.test.ts` | 新建 | 控件单测 |
| `src/renderer/src/components/settings/TasksTab.vue` | 修改 | 全局「单次运行超时」行 |
| `src/renderer/src/components/settings/TasksTab.test.ts` | 修改 | 默认值 + 写入断言 |
| `src/renderer/src/components/tasks/TaskFormDialog.vue` | 修改 | 任务表单「超时时间」字段 |
| `src/renderer/src/components/tasks/TaskFormDialog.test.ts` | 新建 | 提交载荷与回填断言 |
| `src/renderer/src/stores/tasks.ts` | 修改 | `saveTask` 载荷加 `timeoutMs` |
| `src/renderer/src/components/tasks/TaskDetailPane.vue` | 修改 | 覆盖时显示超时 chip |
| `tests/main/tasks/db.test.ts` | 修改 | v2 → v3 迁移测试 |
| `tests/main/tasks/store.test.ts` | 修改 | timeoutMs CRUD 测试 |
| `tests/main/tasks/schedule.test.ts` | 修改 | resolveRunTimeout / formatTimeoutLabel 测试 |
| `tests/main/tasks/runner.test.ts` | 修改 | 动态超时与文案测试 |
| `CLAUDE.md` | 修改 | 更新任务子系统常量描述 |

---

### Task 1: 数据层——schema v3 与 store 字段

**Files:**
- Modify: `src/main/tasks/db.ts`
- Modify: `src/main/tasks/store.ts`
- Test: `tests/main/tasks/db.test.ts`、`tests/main/tasks/store.test.ts`

**Interfaces:**
- Consumes: 现有 `addColumn()` 迁移助手（db.ts）
- Produces（后续任务依赖）：
  - `TaskRow.timeoutMs: number | null`（NULL = 跟随全局）
  - `CreateTaskInput.timeoutMs?: number | null`、`TaskPatch.timeoutMs: number | null`
  - 数据库列 `tasks.timeout_ms INTEGER`

- [ ] **Step 1: 写失败的迁移测试（db.test.ts）**

在 `tests/main/tasks/db.test.ts` 的 `describe('db')` 内、`v1 老库升级` 用例之后追加：

```ts
  it('v2 老库升级：补出 timeout_ms 列，老行为 NULL（跟随全局）', () => {
    const f = tmpFile();
    setDbFile(f);
    // 造 v2 形状的库（有 schedule_start_at / schedule_end_at，无 timeout_ms），
    // 再走 migrate —— CREATE TABLE IF NOT EXISTS 不会加列，必须靠 ALTER 补。
    const raw = new DatabaseSync(f);
    raw.exec(`CREATE TABLE tasks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      prompt TEXT NOT NULL, agent TEXT, session_id TEXT,
      session_initialized INTEGER NOT NULL DEFAULT 0, schedule_type TEXT NOT NULL,
      schedule_expr TEXT, run_at INTEGER, schedule_start_at INTEGER, schedule_end_at INTEGER,
      next_run_at INTEGER, last_run_at INTEGER, last_status TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    raw.prepare("INSERT INTO tasks(id,name,prompt,schedule_type,schedule_expr,created_at,updated_at) VALUES('old','老任务','p','cron','0 9 * * *',1,1)").run();
    raw.close();

    const db = getDb();
    const cols = (db.prepare('PRAGMA table_info(tasks)').all() as any[]).map((c) => c.name);
    expect(cols).toContain('timeout_ms');
    const row = db.prepare("SELECT timeout_ms FROM tasks WHERE id='old'").get() as any;
    expect(row.timeout_ms).toBeNull();
  });
```

同时在 `tests/main/tasks/store.test.ts` 里追加 CRUD 测试（沿用该文件现有的 `createTask` 造数风格；`sessionId` 用 `'11111111-1111-4111-8111-111111111111'` 形状的固定串）：

```ts
  it('createTask / updateTask 读写 timeoutMs，null = 跟随全局', () => {
    const t = createTask({
      name: 'n', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
      timeoutMs: 3600000,
    });
    expect(getTask(t.id)!.timeoutMs).toBe(3600000);

    const u = updateTask(t.id, { timeoutMs: null });
    expect(u.timeoutMs).toBeNull();

    const u2 = updateTask(t.id, { timeoutMs: 604800000 });
    expect(u2.timeoutMs).toBe(604800000);
  });

  it('不传 timeoutMs 时默认 NULL（跟随全局）', () => {
    const t = createTask({
      name: 'n', prompt: 'p', sessionId: '11111111-1111-4111-8111-111111111111',
      scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
    });
    expect(getTask(t.id)!.timeoutMs).toBeNull();
  });
```

（store.test.ts 顶部 import 若缺 `getTask`/`updateTask`，从 `../../../src/main/tasks/store.js` 补齐。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:main -- tests/main/tasks/db.test.ts tests/main/tasks/store.test.ts`
Expected: FAIL —— db 用例报 `expect(cols).toContain('timeout_ms')` 失败；store 用例 TS/运行时报 `timeoutMs` 不存在。

- [ ] **Step 3: 实现 db.ts + store.ts**

`src/main/tasks/db.ts`：

```ts
export const SCHEMA_VERSION = 3;
```

`migrate()` 里 v2 的两个 `addColumn` 之后追加：

```ts
  // v3：单次运行超时可配置。NULL = 跟随全局默认（设置键 tasks_run_timeout_ms）。
  addColumn(database, 'tasks', 'timeout_ms', 'INTEGER');
```

`src/main/tasks/store.ts`：

- `TaskRow` 的 `scheduleEndAt` 之后加一行：

```ts
  /** 单次运行超时（毫秒）。NULL = 跟随全局默认 */
  timeoutMs: number | null;
```

- `TaskPatch` 的 `scheduleEndAt` 之后加 `timeoutMs: number | null;`
- `CreateTaskInput` 的 `scheduleEndAt` 之后加 `timeoutMs?: number | null;`
- `TASK_COLUMNS` 加 `timeout_ms AS timeoutMs,`（放在 `schedule_end_at AS scheduleEndAt,` 之后）。
- `PATCH_COLUMN` 加 `timeoutMs: 'timeout_ms',`。
- `createTask` 的 INSERT 语句与参数（加 `timeout_ms` 列，值 `input.timeoutMs ?? null`）：

```ts
  getDb()
    .prepare(
      `INSERT INTO tasks
       (id,name,enabled,prompt,agent,session_id,session_initialized,
        schedule_type,schedule_expr,run_at,schedule_start_at,schedule_end_at,timeout_ms,
        next_run_at,last_run_at,last_status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`,
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
      input.scheduleStartAt ?? null,
      input.scheduleEndAt ?? null,
      input.timeoutMs ?? null,
      input.nextRunAt,
      now,
      now,
    );
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:main -- tests/main/tasks/db.test.ts tests/main/tasks/store.test.ts`
Expected: PASS（全部用例绿）。

- [ ] **Step 5: Commit**

```bash
npm run test:main && (cd src/renderer && npx vue-tsc --noEmit)
git add src/main/tasks/db.ts src/main/tasks/store.ts tests/main/tasks/db.test.ts tests/main/tasks/store.test.ts
git commit -m "feat: 任务表新增 timeout_ms 列（schema v3，NULL=跟随全局超时）"
```

---

### Task 2: 超时解析纯函数（schedule.ts）

**Files:**
- Modify: `src/main/tasks/schedule.ts`
- Test: `tests/main/tasks/schedule.test.ts`

**Interfaces:**
- Consumes: 现有 `RUN_TIMEOUT_MS`（保留，作最终兜底）
- Produces（Task 3 依赖）：
  - `resolveRunTimeout(taskTimeoutMs: number | null | undefined, globalTimeoutMs: number | null | undefined): number`
  - `formatTimeoutLabel(ms: number): string`（如 `2 小时` / `30 分钟`）
  - `RUN_TIMEOUT_MIN_MS = 60_000`、`RUN_TIMEOUT_MAX_MS = 604_800_000`

- [ ] **Step 1: 写失败的测试（schedule.test.ts）**

在 `tests/main/tasks/schedule.test.ts` 末尾追加（import 里补 `resolveRunTimeout, formatTimeoutLabel, RUN_TIMEOUT_MS, RUN_TIMEOUT_MIN_MS, RUN_TIMEOUT_MAX_MS`）：

```ts
describe('resolveRunTimeout', () => {
  it('任务覆盖优先于全局，全局优先于 30 分钟兜底', () => {
    expect(resolveRunTimeout(7200000, 900000)).toBe(7200000);
    expect(resolveRunTimeout(null, 900000)).toBe(900000);
    expect(resolveRunTimeout(undefined, 900000)).toBe(900000);
    expect(resolveRunTimeout(null, null)).toBe(RUN_TIMEOUT_MS);
    expect(resolveRunTimeout(undefined, undefined)).toBe(RUN_TIMEOUT_MS);
  });

  it('脏值逐档回退：NaN / 0 / 负数 / 越界视为无效', () => {
    expect(resolveRunTimeout(NaN, 900000)).toBe(900000);
    expect(resolveRunTimeout(0, 900000)).toBe(900000);
    expect(resolveRunTimeout(-1, 900000)).toBe(900000);
    expect(resolveRunTimeout(30_000, 900000)).toBe(900000); // < 1 分钟
    expect(resolveRunTimeout(604_800_001, 900000)).toBe(900000); // > 7 天
    // 全局也是脏值时落兜底
    expect(resolveRunTimeout(NaN, NaN)).toBe(RUN_TIMEOUT_MS);
  });

  it('边界：1 分钟与 7 天放行', () => {
    expect(resolveRunTimeout(RUN_TIMEOUT_MIN_MS, null)).toBe(60_000);
    expect(resolveRunTimeout(RUN_TIMEOUT_MAX_MS, null)).toBe(604_800_000);
  });
});

describe('formatTimeoutLabel', () => {
  it('整小时显示「N 小时」，否则显示「N 分钟」', () => {
    expect(formatTimeoutLabel(3600000)).toBe('1 小时');
    expect(formatTimeoutLabel(7200000)).toBe('2 小时');
    expect(formatTimeoutLabel(1800000)).toBe('30 分钟');
    expect(formatTimeoutLabel(900000)).toBe('15 分钟');
    expect(formatTimeoutLabel(60000)).toBe('1 分钟');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:main -- tests/main/tasks/schedule.test.ts`
Expected: FAIL —— `resolveRunTimeout` 未导出（import 报错）。

- [ ] **Step 3: 实现 schedule.ts**

在 `RUN_TIMEOUT_MS` 定义附近追加（并把 `RUN_TIMEOUT_MS` 的注释改为「默认上限」语义）：

```ts
/** 单次 run 的默认墙钟上限（任务 timeout_ms / 全局 tasks_run_timeout_ms 可覆盖，见 resolveRunTimeout）。 */
export const RUN_TIMEOUT_MS = 30 * 60 * 1000;

/** 可配置超时的合法范围：1 分钟 ~ 7 天。7 天远小于 setTimeout 的 2^31-1 ms 溢出阈值（~24.8 天）。 */
export const RUN_TIMEOUT_MIN_MS = 60 * 1000;
export const RUN_TIMEOUT_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** 归一化单个超时值：非有限数 / 越界视为无效。 */
function validTimeout(ms: unknown): number | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const n = Math.floor(ms);
  return n >= RUN_TIMEOUT_MIN_MS && n <= RUN_TIMEOUT_MAX_MS ? n : null;
}

/** 超时解析：任务覆盖 > 全局默认 > RUN_TIMEOUT_MS 兜底。两个入参都由调用方传入（纯函数，不读 store）。 */
export function resolveRunTimeout(
  taskTimeoutMs: number | null | undefined,
  globalTimeoutMs: number | null | undefined,
): number {
  return validTimeout(taskTimeoutMs) ?? validTimeout(globalTimeoutMs) ?? RUN_TIMEOUT_MS;
}

/** 超时文案里的时长：整小时显示「N 小时」，否则显示「N 分钟」。 */
export function formatTimeoutLabel(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} 小时`;
  return `${Math.round(ms / 60_000)} 分钟`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:main -- tests/main/tasks/schedule.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run test:main && (cd src/renderer && npx vue-tsc --noEmit)
git add src/main/tasks/schedule.ts tests/main/tasks/schedule.test.ts
git commit -m "feat: 超时解析纯函数 resolveRunTimeout 与文案 formatTimeoutLabel"
```

---

### Task 3: runner 动态超时 + IPC 接线

**Files:**
- Modify: `src/main/tasks/runner.ts:451-475`（startRun）、RunnerDeps 定义处
- Modify: `src/main/tasks/index.ts`（tasks:create / tasks:update / outcomeText）
- Test: `tests/main/tasks/runner.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `task.timeoutMs`、Task 2 的 `resolveRunTimeout` / `formatTimeoutLabel`
- Produces:
  - `RunnerDeps.readGlobalTimeout(): number | null`（默认读设置 `tasks_run_timeout_ms`）
  - IPC `tasks:create` input 增加 `timeoutMs?: number | null`；`tasks:update` patch 增加 `timeoutMs?: number | null`
  - timeout 终态的 `run.error` 形如 `超过 2 小时上限，已终止`

- [ ] **Step 1: 写失败的测试（runner.test.ts）**

两处改动：

(a) `beforeEach` 的 `setRunnerDeps({ ... })` 里补一行（现有注入项之后）：

```ts
    // 全局超时默认回退：单测不读真实设置
    readGlobalTimeout: () => null,
```

(b) 在现有 `cancelRun` 用例之前追加两个用例：

```ts
  it('超时到点杀进程，文案带实际时长（任务覆盖优先于全局）', async () => {
    vi.useFakeTimers();
    try {
      const t = createTask({
        name: 'n', prompt: '干活', sessionId: '11111111-1111-4111-8111-111111111111',
        scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null, nextRunAt: null,
        timeoutMs: 7200000, // 任务覆盖 2 小时
      });
      const r = createRun(t.id, 'scheduled');
      markRunRunning(r.id);
      setRunnerDeps({ readGlobalTimeout: () => 900000 }); // 全局 15 分钟，应被覆盖压过
      startRun(getRun(r.id)!, getTask(t.id)!, { onEvent: () => {}, onFinish: () => {} });
      await vi.advanceTimersByTimeAsync(7_200_001);
      const done = getRun(r.id)!;
      expect(done.status).toBe('timeout');
      expect(done.error).toBe('超过 2 小时上限，已终止');
    } finally {
      vi.useRealTimers();
    }
  });

  it('无任务覆盖时用全局时长生成文案', async () => {
    vi.useFakeTimers();
    try {
      const { task, run } = seed();
      setRunnerDeps({ readGlobalTimeout: () => 900000 });
      startRun(run, task, { onEvent: () => {}, onFinish: () => {} });
      await vi.advanceTimersByTimeAsync(900_001);
      const done = getRun(run.id)!;
      expect(done.status).toBe('timeout');
      expect(done.error).toBe('超过 15 分钟上限，已终止');
    } finally {
      vi.useRealTimers();
    }
  });
```

（`getRun` 若未在该文件 import，从 `../../../src/main/tasks/store.js` 补齐。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:main -- tests/main/tasks/runner.test.ts`
Expected: FAIL —— `readGlobalTimeout` 不在 `RunnerDeps`（TS 报错）或超时 30 分钟而非 2 小时（文案断言失败）。

- [ ] **Step 3: 实现 runner.ts**

(a) import 调整：

```ts
import { getStore } from '../store.js';
import { formatTimeoutLabel, resolveRunTimeout } from './schedule.js';
```

（删掉原来的 `import { RUN_TIMEOUT_MS } from './schedule.js';`。）

(b) `RunnerDeps` 增加：

```ts
  /** 全局默认超时（毫秒）。默认读设置 tasks_run_timeout_ms；测试注入固定值。 */
  readGlobalTimeout(): number | null;
```

(c) 默认 `deps` 增加：

```ts
  readGlobalTimeout: () => {
    try {
      const raw = getStore('settings').get('tasks_run_timeout_ms');
      return typeof raw === 'number' ? raw : null;
    } catch {
      return null;
    }
  },
```

(d) `startRun` 里的 timer 段替换为：

```ts
  const limitMs = resolveRunTimeout(task.timeoutMs, deps.readGlobalTimeout());
  a.timer = setTimeout(() => {
    if (!active.has(run.id)) return;
    killRun(a, 'timeout', { error: `超过 ${formatTimeoutLabel(limitMs)}上限，已终止` });
  }, limitMs);
```

- [ ] **Step 4: 实现 index.ts 接线**

(a) `outcomeText` 的 timeout 分支（`src/main/tasks/index.ts:127`）：

```ts
    case 'timeout': return run.error ?? '超过运行超时上限，已终止';
```

(b) `tasks:create` 的 input 类型与 `createTask` 调用：

```ts
  ipcMain.handle('tasks:create', (_e, input: {
    name: string; prompt: string; schedule: Schedule; timeoutMs?: number | null;
  }) => {
    const sessionId = randomUUID();
    const fields = scheduleFields(input.schedule);
    const task = createTask({
      name: input.name.trim(),
      prompt: input.prompt,
      sessionId,
      ...fields,
      timeoutMs: input.timeoutMs ?? null,
      nextRunAt: computeNextRun(input.schedule, Date.now()),
    });
```

(c) `tasks:update` 的 patch 类型与字段映射：

```ts
  ipcMain.handle('tasks:update', (_e, id: string, patch: {
    name?: string; prompt?: string; schedule?: Schedule; enabled?: boolean; timeoutMs?: number | null;
  }) => {
    const before = getTask(id);
    if (!before) throw new Error(`任务不存在: ${id}`);

    const fields: Parameters<typeof updateTask>[1] = {};
    if (patch.name !== undefined) fields.name = patch.name.trim();
    if (patch.prompt !== undefined) fields.prompt = patch.prompt;
    if (patch.enabled !== undefined) fields.enabled = patch.enabled;
    if (patch.timeoutMs !== undefined) fields.timeoutMs = patch.timeoutMs;
```

（`toTaskDto` 用 `...task` 展开，`timeoutMs` 自动透传，无需改。）

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run test:main -- tests/main/tasks/runner.test.ts`
Expected: PASS（新用例 + 既有用例全绿 —— 既有用例不受影响，因为 `readGlobalTimeout` 注入了 `() => null`）。

- [ ] **Step 6: Commit**

```bash
npm run test:main && (cd src/renderer && npx vue-tsc --noEmit)
git add src/main/tasks/runner.ts src/main/tasks/index.ts tests/main/tasks/runner.test.ts
git commit -m "feat: 任务运行超时按任务/全局配置生效，超时文案带实际时长"
```

---

### Task 4: 渲染层类型、默认值与 TimeoutPicker 共享控件

**Files:**
- Modify: `src/renderer/src/types/settings.ts`（`tasks_run_timeout_ms`）
- Modify: `src/renderer/src/stores/settings.ts`（defaultSettings）
- Modify: `src/renderer/src/types/tasks.ts`（`TaskDto.timeoutMs`）
- Modify: `src/renderer/src/utils/tasks.ts`（`timeoutLabel`）
- Create: `src/renderer/src/components/TimeoutPicker.vue`
- Test: `src/renderer/src/components/TimeoutPicker.test.ts`

**Interfaces:**
- Consumes: 无（纯渲染层）
- Produces（Task 5/6 依赖）：
  - `TimeoutPicker.vue`：props `{ modelValue: number | null; allowDefault?: boolean }`；emits `update:modelValue(number | null)`、`update:valid(boolean)`
  - `timeoutLabel(ms: number): string`（utils/tasks.ts）
  - `Settings.tasks_run_timeout_ms: number`、`TaskDto.timeoutMs: number | null`

- [ ] **Step 1: 写失败的控件测试**

新建 `src/renderer/src/components/TimeoutPicker.test.ts`：

```ts
// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TimeoutPicker from './TimeoutPicker.vue'

const byText = (w: ReturnType<typeof mount>, t: string) =>
  w.findAll('.radio').find((b) => b.text() === t)!

describe('TimeoutPicker', () => {
  it('选预设档写回对应毫秒值', async () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 1800000 } })
    await byText(w, '1h').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([3600000])
    expect(w.emitted('update:valid')!.at(-1)).toEqual([true])
  })

  it('allowDefault 时多一档「默认」，点击写回 null', async () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 1800000, allowDefault: true } })
    expect(byText(w, '默认').exists()).toBe(true)
    await byText(w, '默认').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([null])
  })

  it('不允许默认时没有「默认」档', () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 1800000 } })
    expect(w.findAll('.radio').some((b) => b.text() === '默认')).toBe(false)
  })

  it('自定义回填：整小时用「小时」，非整小时用「分钟」', () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 7200000 } }) // 2h，非预设
    expect((w.find('input').element as HTMLInputElement).value).toBe('2')
    const w2 = mount(TimeoutPicker, { props: { modelValue: 2700000 } }) // 45min，非预设
    expect((w2.find('input').element as HTMLInputElement).value).toBe('45')
    expect((w2.find('select').element as HTMLSelectElement).value).toBe('minute')
  })

  it('预设值命中预设档而不是自定义', () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 86400000 } })
    expect(w.find('input').exists()).toBe(false)
  })

  it('自定义越界：update:valid=false、就地报错、不写回值', async () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 1800000 } })
    await byText(w, '自定义').trigger('click')
    await w.find('input').setValue(0) // 0 分钟越界
    expect(w.emitted('update:valid')!.at(-1)).toEqual([false])
    expect(w.find('.warn-inline').exists()).toBe(true)
    const vals = w.emitted('update:modelValue')!
    expect(vals.at(-1)).not.toEqual([0])
  })

  it('自定义合法值写回毫秒（小时单位）', async () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 1800000 } })
    await byText(w, '自定义').trigger('click')
    await w.find('select').setValue('hour')
    await w.find('input').setValue(2)
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([7200000])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src/renderer && npx vitest run src/components/TimeoutPicker.test.ts`
Expected: FAIL —— `TimeoutPicker.vue` 不存在（解析失败）。

- [ ] **Step 3: 实现 TimeoutPicker.vue 与类型/默认值**

新建 `src/renderer/src/components/TimeoutPicker.vue`：

```vue
<!-- 超时选择器：预设档（15m/30m/1h/8h/24h）+ 自定义（数值 + 分钟/小时）。
     两处复用：设置 → 定时任务（无「默认」档）与任务表单（allowDefault，开头多一档「默认（跟随全局）」）。
     自定义越界（<1 分钟 / >7 天）就地报错且 update:valid=false，父级据此禁保存。
     单位回填规则：整小时用「小时」，否则「分钟」向上取整（与 spec §5.2 一致）。 -->
<template>
  <div class="tp">
    <div class="tp-row">
      <button
        v-if="allowDefault"
        class="radio"
        :class="{ on: mode === 'default' }"
        @click="pickDefault"
      >默认</button>
      <button
        v-for="p in PRESETS"
        :key="p.ms"
        class="radio"
        :class="{ on: mode === 'preset' && pickedMs === p.ms }"
        @click="pickPreset(p.ms)"
      >{{ p.label }}</button>
      <button class="radio" :class="{ on: mode === 'custom' }" @click="pickCustom">自定义</button>
    </div>
    <div v-if="mode === 'custom'" class="tp-custom">
      <input v-model.number="customValue" class="tp-num" type="number" min="1" @input="emitCustom" />
      <select v-model="customUnit" class="tp-unit" @change="emitCustom">
        <option value="minute">分钟</option>
        <option value="hour">小时</option>
      </select>
      <span v-if="!customValid" class="tp-warn">范围 1 分钟 ~ 7 天</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  /** 毫秒。null = 跟随全局（仅 allowDefault 时会出现） */
  modelValue: number | null
  /** 是否提供「默认（跟随全局）」档 */
  allowDefault?: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: number | null): void
  (e: 'update:valid', v: boolean): void
}>()

const MIN_MS = 60_000
const MAX_MS = 7 * 24 * 60 * 60 * 1000
const PRESETS = [
  { ms: 15 * 60_000, label: '15m' },
  { ms: 30 * 60_000, label: '30m' },
  { ms: 60 * 60_000, label: '1h' },
  { ms: 8 * 60 * 60_000, label: '8h' },
  { ms: 24 * 60 * 60_000, label: '24h' },
]

type Mode = 'default' | 'preset' | 'custom'
const mode = ref<Mode>('default')
const pickedMs = ref<number | null>(null)
const customValue = ref(30)
const customUnit = ref<'minute' | 'hour'>('minute')

const customMs = computed(() => customValue.value * (customUnit.value === 'hour' ? 3600_000 : 60_000))
const customValid = computed(
  () => Number.isFinite(customMs.value) && customMs.value >= MIN_MS && customMs.value <= MAX_MS,
)

/** 最近一次写回的值：回声（父级把同值回传）不再触发 sync，避免打字中途被切成预设档 */
let lastSent: number | null | undefined = undefined

function syncFromProp(): void {
  const v = props.modelValue
  if (v == null) {
    mode.value = 'default'
    pickedMs.value = null
    return
  }
  const hit = PRESETS.find((p) => p.ms === v)
  if (hit) {
    mode.value = 'preset'
    pickedMs.value = hit.ms
    return
  }
  mode.value = 'custom'
  pickedMs.value = null
  if (v % 3600_000 === 0) {
    customUnit.value = 'hour'
    customValue.value = v / 3600_000
  } else {
    customUnit.value = 'minute'
    customValue.value = Math.ceil(v / 60_000)
  }
}

onMounted(syncFromProp)
watch(() => props.modelValue, (v) => {
  if (v === lastSent) return
  syncFromProp()
})

function pickDefault(): void {
  mode.value = 'default'
  pickedMs.value = null
  lastSent = null
  emit('update:modelValue', null)
  emit('update:valid', true)
}

function pickPreset(ms: number): void {
  mode.value = 'preset'
  pickedMs.value = ms
  lastSent = ms
  emit('update:modelValue', ms)
  emit('update:valid', true)
}

function pickCustom(): void {
  mode.value = 'custom'
  pickedMs.value = null
  emitCustom()
}

function emitCustom(): void {
  if (!customValid.value) {
    emit('update:valid', false)
    return
  }
  lastSent = customMs.value
  emit('update:valid', true)
  emit('update:modelValue', customMs.value)
}
</script>

<style scoped>
.tp { display: flex; flex-direction: column; gap: 8px; }
.tp-row { display: flex; flex-wrap: wrap; gap: 6px; }
.radio {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  font-size: var(--fs-caption);
  font-family: inherit;
  color: var(--text-secondary);
  cursor: pointer;
  background: var(--bg-card);
  user-select: none;
}
.radio:hover { background: var(--bg-hover); }
.radio.on { border-color: var(--accent); background: var(--accent-soft-bg); color: var(--accent); font-weight: 500; }
.tp-custom { display: flex; align-items: center; gap: 8px; }
.tp-num {
  width: 72px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--fs-caption);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.tp-unit {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--fs-caption);
  font-family: inherit;
}
.tp-warn { font-size: 11px; color: var(--status-error); }
</style>
```

`src/renderer/src/types/settings.ts`：`tasks_max_concurrency` 之后加：

```ts
  /** 单次运行超时默认值（毫秒）。任务可用 timeoutMs 覆盖 */
  tasks_run_timeout_ms: number
```

`src/renderer/src/stores/settings.ts` `defaultSettings()` 的 `tasks_max_concurrency: 6,` 之后加：

```ts
    /** 单次运行超时默认值（毫秒）：30 分钟 */
    tasks_run_timeout_ms: 30 * 60 * 1000,
```

`src/renderer/src/types/tasks.ts` `TaskDto` 的 `scheduleEndAt` 之后加：

```ts
  /** 单次运行超时（毫秒）。null = 跟随全局默认 */
  timeoutMs: number | null;
```

`src/renderer/src/utils/tasks.ts` 末尾追加：

```ts
/** 超时时长的展示：整小时显示「N 小时」，否则「N 分钟」。
 *  与主进程 schedule.ts 的 formatTimeoutLabel 各有一份 —— 主/渲染是两个 bundle，不能互 import。 */
export function timeoutLabel(ms: number): string {
  if (ms % 3600000 === 0) return `${ms / 3600000} 小时`
  return `${Math.round(ms / 60000)} 分钟`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src/renderer && npx vitest run src/components/TimeoutPicker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run test:main && (cd src/renderer && npx vue-tsc --noEmit)
git add src/renderer/src/components/TimeoutPicker.vue src/renderer/src/components/TimeoutPicker.test.ts src/renderer/src/types/settings.ts src/renderer/src/stores/settings.ts src/renderer/src/types/tasks.ts src/renderer/src/utils/tasks.ts
git commit -m "feat: TimeoutPicker 超时选择器与渲染层超时类型/默认值"
```

---

### Task 5: 设置页「单次运行超时」（TasksTab）

**Files:**
- Modify: `src/renderer/src/components/settings/TasksTab.vue`
- Test: `src/renderer/src/components/settings/TasksTab.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `TimeoutPicker`（props `modelValue`，emits `update:modelValue`）
- Produces: 设置键 `tasks_run_timeout_ms` 的读写入口（设置 → 定时任务页）

- [ ] **Step 1: 写失败的测试（TasksTab.test.ts）**

在 `TasksTab.test.ts` 的 `describe` 内追加（`mountTab` 的 GetSettings mock 不需要加键 —— `load()` 会与默认值合并出 1800000，这正好顺带验证默认值生效）：

```ts
  it('单次运行超时默认 30 分钟，选预设写入 tasks_run_timeout_ms', async () => {
    const { wrapper: w } = await mountTab()
    wrapper = w as any
    const settings = useSettingsStore()

    // 默认值合并：无键时 30 分钟，预设 30m 应为选中态
    expect((settings.cfg as any).tasks_run_timeout_ms).toBe(1800000)
    const preset30 = w.findAll('.radio').find((b) => b.text() === '30m')!
    expect(preset30.classes()).toContain('on')

    await w.findAll('.radio').find((b) => b.text() === '1h')!.trigger('click')
    await flushPromises()
    expect((settings.cfg as any).tasks_run_timeout_ms).toBe(3600000)
  })
```

注意：这个新用例放在**新的 describe 块**里（不要塞进「通知机器人选择」那个 describe —— 那个块的 afterEach 只清理它自己的 wrapper 变量），结构如下：

```ts
describe('TasksTab 单次运行超时', () => {
  let wrapper: Awaited<ReturnType<typeof mountTab>>['wrapper'] | null = null
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })
  it('单次运行超时默认 30 分钟，选预设写入 tasks_run_timeout_ms', async () => {
    /* 同上用例体 */
  })
})
```

（`useSettingsStore` 已在该文件 import；`.radio` 是 TimeoutPicker 的按钮类名 —— 挂真实 TimeoutPicker，不 stub。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src/renderer && npx vitest run src/components/settings/TasksTab.test.ts`
Expected: FAIL —— `.radio` 找不到（控件还没挂上）。

- [ ] **Step 3: 实现 TasksTab.vue**

(a) template：「并发上限」form-group 之后、「通知机器人」form-group 之前插入：

```html
    <div class="form-group">
      <label class="form-label">单次运行超时</label>
      <TimeoutPicker :model-value="timeoutModel" @update:model-value="onTimeoutChange" />
      <p class="hint block">单个任务最多跑多久，到点自动终止。任务编辑里可单独覆盖。</p>
    </div>
```

(b) script：import 与处理函数（放 `bump` 函数旁）：

```ts
import TimeoutPicker from '../TimeoutPicker.vue'

/** 当前全局超时值（毫秒）。读不到/脏值回退 30 分钟 */
const timeoutModel = computed(() => {
  const n = Number(cfg.value.tasks_run_timeout_ms)
  return Number.isFinite(n) && n > 0 ? n : 30 * 60 * 1000
})

function onTimeoutChange(ms: number | null) {
  // 设置页没有「默认」档，ms 理论上恒为 number；null 只作防御回退
  cfg.value.tasks_run_timeout_ms = ms ?? 30 * 60 * 1000
  settings.markDirty()
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src/renderer && npx vitest run src/components/settings/TasksTab.test.ts`
Expected: PASS（新用例 + 既有「通知机器人」用例全绿）。

- [ ] **Step 5: Commit**

```bash
npm run test:main && (cd src/renderer && npx vue-tsc --noEmit)
git add src/renderer/src/components/settings/TasksTab.vue src/renderer/src/components/settings/TasksTab.test.ts
git commit -m "feat: 设置页新增「单次运行超时」全局默认配置"
```

---

### Task 6: 任务表单超时字段 + 详情 chip

**Files:**
- Modify: `src/renderer/src/components/tasks/TaskFormDialog.vue`
- Modify: `src/renderer/src/stores/tasks.ts`（saveTask 载荷）
- Modify: `src/renderer/src/components/tasks/TaskDetailPane.vue`
- Test: `src/renderer/src/components/tasks/TaskFormDialog.test.ts`（新建）

**Interfaces:**
- Consumes: Task 4 的 `TimeoutPicker`（`allowDefault`）与 `timeoutLabel`；Task 3 的 IPC 载荷 `timeoutMs`
- Produces: `TaskFormDialog` 的 `submit` 事件载荷增加 `timeoutMs: number | null`；`saveTask(input, id?)` 的 input 增加 `timeoutMs: number | null`

- [ ] **Step 1: 写失败的测试（TaskFormDialog.test.ts）**

新建 `src/renderer/src/components/tasks/TaskFormDialog.test.ts`（useElectron 的 mock 名单 = `stores/tasks.ts` 顶部 import 列表的全集，缺一个 import 就会炸）：

```ts
// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import TaskFormDialog from './TaskFormDialog.vue'
import type { TaskDto } from '../../types/tasks'

vi.mock('../../composables/useElectron', () => ({
  TasksList: vi.fn().mockResolvedValue([]),
  TasksGet: vi.fn(),
  TasksCreate: vi.fn(),
  TasksUpdate: vi.fn(),
  TasksDelete: vi.fn(),
  TasksSetEnabled: vi.fn(),
  TasksRunNow: vi.fn(),
  TasksCancel: vi.fn(),
  TasksRuns: vi.fn().mockResolvedValue([]),
  TasksRun: vi.fn(),
  TasksRunEvents: vi.fn().mockResolvedValue([]),
  TasksPreview: vi.fn().mockResolvedValue({
    nextRuns: [Date.now() + 3600000],
    summary: '每天 09:00',
    error: null,
  }),
  TasksTemplates: vi.fn().mockResolvedValue([]),
  TasksSaveTemplate: vi.fn(),
  TasksDeleteTemplate: vi.fn(),
  OnTasksChanged: vi.fn(() => vi.fn()),
  OnTasksRunChanged: vi.fn(() => vi.fn()),
  OnTasksRunEvent: vi.fn(() => vi.fn()),
  EventsOn: vi.fn(() => vi.fn()),
}))

/** 简化 TimeoutPicker：这里只验表单接线，控件行为在 TimeoutPicker.test.ts */
const TimeoutPickerStub = {
  name: 'TimeoutPicker',
  props: ['modelValue', 'allowDefault'],
  emits: ['update:modelValue', 'update:valid'],
  template: '<div class="tp-stub" />',
}

function mountForm(mode: 'create' | 'edit', task: TaskDto | null) {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(TaskFormDialog, {
    props: { mode, task },
    global: { stubs: { TimeoutPicker: TimeoutPickerStub, Icon: true } },
  })
}

/** 造一个能通过 canSubmit 的表单内容（名称 + prompt + 合法调度） */
async function fillValid(w: ReturnType<typeof mountForm>) {
  await w.find('input.name-inp').setValue('日报')
  await w.find('textarea').setValue('写日报')
  await flushPromises() // 等 preview mock 返回，nextRuns 非空
}

const baseTask = {
  id: 't1', name: '日报', enabled: true, prompt: '写日报', agent: null,
  sessionId: 's1', sessionInitialized: false,
  scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null,
  scheduleStartAt: null, scheduleEndAt: null,
  nextRunAt: Date.now() + 3600000, lastRunAt: null, lastStatus: null,
  createdAt: 1, updatedAt: 1,
  schedule: '每天 09:00',
  scheduleRaw: { type: 'daily', hour: 9, minute: 0, days: [0, 1, 2, 3, 4, 5, 6], startAt: null, endAt: null },
  timeoutMs: 7200000,
} as unknown as TaskDto

describe('TaskFormDialog 超时字段', () => {
  let w: ReturnType<typeof mountForm> | null = null
  afterEach(() => {
    w?.unmount()
    w = null
  })

  it('新建默认「默认」（null），提交载荷带 timeoutMs', async () => {
    w = mountForm('create', null)
    await fillValid(w)
    expect(w.findComponent(TimeoutPickerStub).props('modelValue')).toBeNull()

    const picker = w.findComponent(TimeoutPickerStub)
    picker.vm.$emit('update:modelValue', 3600000)
    await w.find('button.btn.primary.tall').trigger('click')
    const payload = w.emitted('submit')!.at(-1)![0] as { timeoutMs: number | null }
    expect(payload.timeoutMs).toBe(3600000)
  })

  it('编辑时按 task.timeoutMs 回填', async () => {
    w = mountForm('edit', baseTask)
    await flushPromises()
    expect(w.findComponent(TimeoutPickerStub).props('modelValue')).toBe(7200000)
  })

  it('自定义越界（valid=false）时不能提交', async () => {
    w = mountForm('create', null)
    await fillValid(w)
    const picker = w.findComponent(TimeoutPickerStub)
    picker.vm.$emit('update:valid', false)
    await flushPromises()
    expect(w.find('button.btn.primary.tall').attributes('disabled')).toBeDefined()
  })
})
```

（若 `mountForm` 的 `Icon: true` stub 影响既有选择器，改用与 `TasksTab.test.ts` 一致的真实 Icon 引入；`input.name-inp` / `textarea` / `button.btn.primary.tall` 是 `TaskFormDialog.vue` 里已有的类名。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src/renderer && npx vitest run src/components/tasks/TaskFormDialog.test.ts`
Expected: FAIL —— `props('modelValue')` 为 undefined（表单还没接 TimeoutPicker）。

- [ ] **Step 3: 实现 TaskFormDialog.vue**

(a) template：「执行频率」sec（`</div>` 结束于 preview 行之后）与「任务内容」sec 之间插入：

```html
            <!-- 超时时间：跟随全局默认或单独覆盖 -->
            <div class="sec">
              <div class="sec-hd"><span class="t">超时时间</span></div>
              <div class="field">
                <label>超时</label>
                <div class="ctl">
                  <TimeoutPicker
                    :model-value="timeoutMs"
                    allow-default
                    @update:model-value="(v) => (timeoutMs = v)"
                    @update:valid="(v) => (timeoutValid = v)"
                  />
                  <div class="hint">超过这个时长自动终止。选「默认」用全局设置（设置 → 定时任务）。</div>
                </div>
              </div>
            </div>
```

(b) script：

- import：`import TimeoutPicker from '../TimeoutPicker.vue'`
- emit 类型改为：

```ts
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', input: { name: string; prompt: string; schedule: ScheduleDto; timeoutMs: number | null }): void
}>()
```

- 状态（放 `cron` 等 ref 旁）：

```ts
/** 超时覆盖：null = 跟随全局默认 */
const timeoutMs = ref<number | null>(null)
const timeoutValid = ref(true)
```

- `canSubmit` 开头加一行：

```ts
  if (!timeoutValid.value) return false
```

- `submit()` 的 emit 载荷加 `timeoutMs: timeoutMs.value`：

```ts
function submit() {
  const s = schedule.value
  if (!s) return
  emit('submit', {
    name: name.value.trim(),
    prompt: prompt.value,
    schedule: s,
    timeoutMs: timeoutMs.value,
  })
}
```

- `onMounted` 里 `if (props.task)` 分支加一行回填（edit / copy 都带）：

```ts
    timeoutMs.value = props.task.timeoutMs
```

- [ ] **Step 4: 实现 saveTask 与 TaskDetailPane**

(a) `src/renderer/src/stores/tasks.ts` 的 `saveTask` 签名：

```ts
  async function saveTask(
    input: { name: string; prompt: string; schedule: ScheduleDto; timeoutMs: number | null },
    id?: string,
  ) {
```

（函数体不动 —— `TasksUpdate(id, input)` / `TasksCreate(input)` 本来就整个透传 input。）

(b) `src/renderer/src/components/tasks/TaskDetailPane.vue` 的 sumbar：`lastCost` chip 之后加：

```html
      <span v-if="task.timeoutMs != null" class="chip">
        <Icon name="alarm-clock" :size="11" />超时 {{ timeoutLabel(task.timeoutMs) }}
      </span>
```

script 的 import 加：

```ts
import { formatNextRun, taskCostHint, timeoutLabel } from '../../utils/tasks'
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd src/renderer && npx vitest run src/components/tasks/TaskFormDialog.test.ts`
Expected: PASS

再跑全量渲染层回归（saveTask 签名变化波及 TasksPane）：

Run: `cd src/renderer && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
npm run test:main && (cd src/renderer && npx vue-tsc --noEmit)
git add src/renderer/src/components/tasks/TaskFormDialog.vue src/renderer/src/components/tasks/TaskFormDialog.test.ts src/renderer/src/stores/tasks.ts src/renderer/src/components/tasks/TaskDetailPane.vue
git commit -m "feat: 任务表单支持超时覆盖，详情页显示超时 chip"
```

---

### Task 7: 全量回归 + 文档更新

**Files:**
- Modify: `CLAUDE.md`（任务子系统常量与不变量描述）

**Interfaces:**
- Consumes: Task 1–6 全部产出
- Produces: 全绿回归 + 与实现一致的文档

- [ ] **Step 1: 更新 CLAUDE.md**

(a) 第 17 节「定时任务」中 `schedule.ts` 的常量行，把：

```
  - 常量：`CATCH_UP_MS`(60min) / `QUEUE_TIMEOUT_MS`(30min) / `RUN_TIMEOUT_MS`(30min)。
```

改为：

```
  - 常量：`CATCH_UP_MS`(60min) / `QUEUE_TIMEOUT_MS`(30min) / `RUN_TIMEOUT_MS`(30min **默认值**)。单次运行超时可配置：全局设置 `tasks_run_timeout_ms` + 每任务 `tasks.timeout_ms`（NULL=跟随全局），`resolveRunTimeout(任务值, 全局值)` 无效值逐档回退（范围 1 分钟 ~ 7 天）。
```

(b) 「重要不变量」小节追加一行：

```
- 任务运行超时解析只认 `resolveRunTimeout`（任务覆盖 > 全局 `tasks_run_timeout_ms` > 30 分钟兜底）；`QUEUE_TIMEOUT_MS` 是排队超时，与此无关。
```

- [ ] **Step 2: 全量回归**

```bash
npm run test:main
cd src/renderer && npx vitest run
cd src/renderer && npx vue-tsc --noEmit
```

Expected: 三条命令全绿。

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: 更新定时任务超时可配置的架构描述"
```

---

## Self-Review 记录

- **Spec 覆盖**：D1（作用域）→ Task 1/5/6；D2（选项集）→ Task 4（PRESETS + 自定义）；D3（自定义形式）→ Task 4；D4（存储）→ Task 1/5；D5（生效时机）→ Task 3（startRun 时解析，不动存量 timer）。spec §4.2 动态文案 → Task 3；§4.3 立即执行走同路径 → 无需额外改动（runTaskNow → startRun，已覆盖并在 Task 3 验证）；§5.3 详情 chip → Task 6；§6 测试清单 → Task 1（迁移）/ 2（纯函数）/ 5（TasksTab）/ 3（runner 文案）+ 回归 Task 7。无缺口。
- **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致性**：`timeoutMs: number | null` 在 TaskRow/TaskPatch/CreateTaskInput/TaskDto/IPC 载荷/saveTask 间一致；`resolveRunTimeout` 两处调用签名一致（Task 2 定义、Task 3 消费）；TimeoutPicker 的 `update:modelValue`/`update:valid` 在 Task 5/6 的用法与 Task 4 定义一致。
