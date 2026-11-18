# 定时任务运行超时可配置 —— 设计文档

- 日期：2026-11-18
- 状态：已确认
- 相关：`docs/superpowers/specs/2026-09-18-tasks-scheduler-design.md`（任务子系统整体设计）

## 1. 背景与目标

任务运行超时目前是写死的常量 `RUN_TIMEOUT_MS = 30 分钟`（`src/main/tasks/schedule.ts`），到点由 `runner.ts` 的 `setTimeout` 杀进程并把 run 标为 `timeout`。长任务（大型重构、全量迁移）30 分钟不够，短任务又嫌 30 分钟太长挂着。

目标：让用户可配置单次运行超时时间 —— 全局给默认值，单个任务可覆盖。

非目标：

- 不改排队超时 `QUEUE_TIMEOUT_MS`（那是「排队等太久就作废」，与执行超时无关）。
- 不支持「不超时 / 无限」选项。
- 不改变超时后的行为（仍为杀进程 + `status='timeout'`）。

## 2. 决策

| # | 决策 | 取值 |
|---|------|------|
| D1 | 作用域 | **全局默认 + 每任务覆盖**：全局设置给默认值，任务可单独覆盖，也可「跟随全局」 |
| D2 | 选项集 | 预设 5 档 **15m / 30m / 1h / 8h / 24h** + **自定义**（数值 + 单位「分钟 / 小时」），范围 1 分钟 ~ 7 天 |
| D3 | 自定义形式 | 数值 + 单位下拉（分钟 / 小时），不做自由文本解析、不做纯分钟数输入 |
| D4 | 存储 | 任务覆盖值进 `tasks` 表新列 `timeout_ms`（NULL = 跟随全局），全局值进设置键 `tasks_run_timeout_ms` |
| D5 | 生效时机 | 只对**之后启动的 run** 生效；已在跑的 run 保持启动时定下的 timer |

## 3. 数据与迁移

### 3.1 schema v3

`src/main/tasks/db.ts` 的 migration 走 `addColumn()`（`PRAGMA table_info` + `ALTER TABLE`），v2 → v3：

```sql
ALTER TABLE tasks ADD COLUMN timeout_ms INTEGER;   -- NULL = 跟随全局
```

- 老库升级后既有任务 `timeout_ms` 全为 NULL（跟随全局），行为与现状一致。
- `store.ts` 的 `COLUMN_MAP` / `TaskRow` 增加 `timeoutMs: number | null`（列名 `timeout_ms`）。
- `createTask` / `updateTask` 接受 `timeoutMs`；`updateTask` 为可选字段（不传不动，传 `null` 即清除覆盖回「跟随全局」）。

### 3.2 全局设置

| 键 | 默认 | 说明 |
|----|------|------|
| `tasks_run_timeout_ms` | `1800000`（30 分钟） | 单次运行超时全局默认值（毫秒） |

进 `src/renderer/src/types/settings.ts` 与 `stores/settings.ts` 默认值。

## 4. 主进程逻辑

### 4.1 超时解析（纯函数）

新增纯函数（放 `src/main/tasks/schedule.ts`，与 `RUN_TIMEOUT_MS` 同处；**不读 store**，两个入参都由调用方传入，保持 schedule.ts 的纯函数约定）：

```
resolveRunTimeout(taskTimeoutMs: number | null | undefined, globalTimeoutMs: number | null | undefined): number
```

优先级：`task.timeoutMs`（有效）> `globalTimeoutMs`（有效）> `RUN_TIMEOUT_MS` 兜底。调用方 `startRun` 负责读 `getStore('settings')` 的 `tasks_run_timeout_ms` 传入。

有效性（归一化）：非有限数、< 60_000（1 分钟）、> 604_800_000（7 天）一律视为无效、落下一档。防脏数据把 `setTimeout` 设成 NaN 或超 24.8 天溢出（`setTimeout` 上限 2^31-1 ms）。

### 4.2 startRun

`runner.ts` 的 `startRun`：

- timer 时长改用 `resolveRunTimeout(task.timeoutMs)`（内部读全局设置）。
- 超时文案动态生成：`超过 {时长} 上限，已终止`（如「超过 2 小时上限，已终止」）。时长展示规则：整小时显示「N 小时」，否则显示「N 分钟」（实现放主进程一个小组件函数即可，不追求与渲染层复用 —— 主/渲染是两个 bundle）。
- `index.ts` 的 `timeout` 状态兜底文案（原「超过 30 分钟上限，已终止」）改为通用文案「超过运行超时上限，已终止」（正常路径 `run.error` 已带动态文案，兜底仅在 error 缺失时出现）。

### 4.3 其他路径

- 「立即执行」`runTaskNow` 与调度触发同走 `startRun`，自动吃配置，无需额外处理。
- `QUEUE_TIMEOUT_MS`、`CATCH_UP_MS` 不动。

## 5. 渲染层 UI

### 5.1 设置 → 定时任务（`TasksTab.vue`）

「并发上限」下新增一行「单次运行超时」：

- 分段按钮：`15m` / `30m` / `1h` / `8h` / `24h` + `自定义`。
- 点「自定义」展开「数值输入 + 单位下拉（分钟 / 小时）」，范围 1 分钟 ~ 7 天，越界就地报错不让保存。
- 无「默认」档（全局页本身就是默认值）。
- 写 `cfg.tasks_run_timeout_ms`（毫秒），走 `settings.markDirty()`。

### 5.2 任务表单（`TaskFormDialog.vue`）

- 新增「超时时间」字段，同款控件，最前面多一档**「默认（跟随全局）」= NULL**。
- 新建任务默认选「默认」；编辑任务按 `timeoutMs` 回填（NULL → 「默认」，预设值命中 → 对应档，否则 → 自定义）。自定义回填单位规则：`ms % 3600000 === 0` 时用「小时」（数值 = ms/3600000），否则用「分钟」（数值 = ms/60000，向上取整）。

### 5.3 任务详情（`TaskDetailPane.vue`）

- 摘要 chips 仅在任务**覆盖**了超时时显示「超时 2 小时」；跟随全局不显示（避免噪音）。
- 超时 run 的展示沿用 `run.error`（已是动态文案），流水视图无需改。

## 6. 测试

1. **迁移**：v2 老库升 v3 后 `timeout_ms` 列存在且既有行为 NULL；新建任务可写入并读回。
2. **超时解析纯函数**：覆盖优先 > 全局 > 兜底；脏值（NaN / 0 / 负数 / 超 7 天）回退；边界 1 分钟与 7 天放行。
3. **TasksTab.test.ts**：默认值断言 + 选预设/自定义写入 `tasks_run_timeout_ms`。
4. **runner 文案**：超时错误含实际时长（如「超过 2 小时上限」）。
5. 回归：`npm run test:main` 与 `cd src/renderer && npx vitest run`、`npx vue-tsc --noEmit` 全绿。

## 7. 兼容性与风险

- 老库自动迁移，既有任务 NULL = 跟随全局 = 现行 30 分钟默认，行为不变。
- 自定义上限 7 天远小于 `setTimeout` 溢出阈值（~24.8 天），安全。
- 主/渲染两个 bundle 不能互 import，超时时长格式化两边各有一小段展示逻辑（主进程生成 run.error 文案、渲染层生成表单 label），接受这点重复。
