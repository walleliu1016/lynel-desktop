# 定时任务（Tasks）设计文档

**日期：** 2026-09-18
**状态：** 待审批
**配套设计稿：** `docs/superpowers/specs/2026-09-18-tasks-scheduler-design-mockup.html`（浏览器打开；直接引用项目真实 `theme.css`，含浅/深色；第 3 节的运行流水基于实测样本）
**参考：** `G:\work\future-kanban\desktop-app\cowagent` 的 scheduler（`agent/tools/scheduler/`）
**实测基准：** claude CLI **2.1.114** / node **v24.11.0** / Electron 43（2026-09-18 本机）

---

## 1. 目标

在左栏「收藏夹」上方新增「任务」入口，提供定时任务能力：按调度周期自动启动一个 Claude 会话执行预设 prompt，完整记录每次执行的事件流，并在 UI 中查看。

参考实现是 cowagent 的 scheduler（Python 侧）。本设计取其**已验证的骨架**（单 JSON 文件存储 → 30s 轮询 tick → 补跑窗口 → 同任务去重 → 隔离会话），但有三处根本性调整：

| cowagent | 本设计 | 原因 |
|---|---|---|
| 跑在常驻 Python 后端的 daemon 线程 | 跑在 Electron 主进程（模块级单例） | Lynel 的「后端」就是主进程 |
| 投递到 IM 渠道（企微/飞书/钉钉） | **执行 = 起一个 Claude 会话** | Lynel 没有 IM 投递需求 |
| 每任务固定 session 复用 | **同左**（`--resume`），但走 `claude -p` 无头模式 | 用户明确要求 |
| JSON 文件存任务 | **SQLite**（任务 + 执行 + 事件三表） | 需要查询/分页/保存完整事件流 |

---

## 2. 核心决策（已确认）

| # | 决策 | 取值 |
|---|---|---|
| D1 | 执行环境 | **直连用户全局 claude 配置**。不注入 `--settings`、不走 apiproxy、不进 Trace/云通道。任务链路自洽子系统 |
| D2 | 流粒度 | **不加 `--include-partial-messages`**，事件粒度 = 完整消息 |
| D3 | 调度表达 | 预设表单 **+** 高级自定义 cron 表达式（互填），底层只存 cron |
| D4 | 权限模式 | `--permission-mode bypassPermissions`（与现有 PTY 路径一致）+ 表单显式警示 |
| D5 | 会话模型 | **一个任务一个会话**：预生成 UUID，首次 `--session-id`，之后 `--resume` |
| D6 | 并发满了 | **进内存队列排队**；排队超 30 分钟标 `skipped`；全局并发上限可配置（默认 6） |
| D7 | 失败处理 | **不自动重试**；`nextRunAt` 照常推进；单次超时 30 分钟 |
| D8 | 补跑窗口 | **60 分钟** |
| D9 | agent 范围 | **v1 只支持 claude 一个 agent**。`-p --output-format stream-json --resume` 是 claude 独有的契约，codex/opencode/omp 的无头参数形状完全不同，不硬套 |
| D10 | 工作目录 | **所有任务共用一个固定目录** `~/.lynel-desktop/tasks/`（设置项 `tasks_dir`）。**`tasks` 表没有 `workdir` 字段**，由常量函数 `tasksDir()` 提供。UI 里没有「项目 / 工作目录」概念 |
| D11 | jsonl 隔离 | **Lynel 侧排除**，不用 `CLAUDE_CONFIG_DIR`。会话扫描器跳过 tasks 目录对应的 project 子目录 |
| D12 | 失败通知 | **只在 run 失败时**用现有 `attention.ts` 弹系统通知，成功不打扰 |

**关于 D9：** `tasks.agent` 字段保留（默认 `'claude'`），供后续扩展，但 v1 的表单里**不提供 agent 选择器**，创建时固定写 `'claude'`。若将来支持别的 agent，`runner.ts` 里按 agent 分派 spawn 参数（对应agents 注册表的 `AgentSpec` 扩展一个新的 `headlessArgs()` 概念）——这是后续任务，不在本设计内。

**关于 D10（工作目录固定）的三个后果，必须知道：**
1. **「项目」概念彻底消失**：不是藏起来，而是数据模型和 UI 里都没有。所有任务共用 cwd，jsonl 都落在同一个 encoded 目录下，`--resume` 的 cwd 耦合随之消解——因此也不存在「改了项目导致会话上下文丢失」的问题。
2. **这不是沙箱**。`bypassPermissions` 下 claude 仍能读写任意路径；固定 cwd 只决定相对路径的基准与 CLAUDE.md 的来源，**不是访问限制**。不要把敏感文件放进 tasks 目录。
3. **prompt 里必须写绝对路径**。任务在 tasks 目录里跑，要操作 `G:\work\lynel-desktop` 得靠 claude 自己 `cd /g/work/lynel-desktop && ...`（Bash 每次调用是新 shell，`cd` 不持久）。且**目标项目的 CLAUDE.md 不会被加载**（CLAUDE.md 按 cwd 发现）。

> 这决定了任务的定位偏向**「自动化脚本 / 提醒 / 汇总」**，而不是「在某个项目里干活的会话」。若将来需要后者，现成的口子是 `--add-dir <项目路径>`（可额外加载该目录的 CLAUDE.md 并授权工具访问）——但那会把目录概念请回来，v1 不做。

**关于 D11（jsonl 隔离）：** CLI 侧**没有**能力指定 jsonl 创建目录，两条看似可行的路都被实测否定：
- `--no-session-persistence`：会连带禁掉 `--resume`，与 D5 冲突。
- `CLAUDE_CONFIG_DIR`：能换掉 `~/.claude`（实测 jsonl 落到 `<新目录>/projects/<cwd-encoded>/`），但**连用户全局配置一起换掉**——实测剥离 `ANTHROPIC_*` 环境变量后返回 `"Not logged in · Please run /login"`（`is_error: true`、`total_cost_usd: 0`），因为 `~/.claude/settings.json` 的 `env` 块不再被读取，直接破坏 D1；且 `plugins/` `skills/` `agents/` memory 全部消失，任务里 claude 的能力与用户平时用的不一致。

所以改为 Lynel 侧排除，见 §5.5。`CLAUDE_CONFIG_DIR` 绝对不要用。

---

## 3. 数据层

**位置：** `~/.lynel-desktop/tasks.db`，SQLite，WAL 模式，单文件。

实现用 **Node 内置 `node:sqlite`**（Electron 43 的 Node ≥22.5，本机 node v24 已确认可用），避免 `better-sqlite3` 的 native rebuild 与 `electron-builder.yml` 打包改动。它是 experimental API，故由 `db.ts` 单点隔离，留好换实现的后路。

```sql
tasks(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  prompt TEXT NOT NULL,
  agent TEXT,
  session_id TEXT,               -- 预生成 UUID
  session_initialized INTEGER,   -- 0 = 首次用 --session-id，1 = 之后用 --resume
  schedule_type TEXT NOT NULL,   -- 'cron' | 'once'
  schedule_expr TEXT,            -- cron 表达式（type = 'cron'）
  run_at INTEGER,                -- epoch ms（type = 'once'）
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)

runs(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  trigger TEXT NOT NULL,         -- 'scheduled' | 'manual'
  status TEXT NOT NULL,          -- queued | running | done | error | timeout | skipped | interrupted
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  session_id TEXT,
  resume_used INTEGER,           -- 本次是否走了 --resume（回退时可诊断）
  exit_code INTEGER,
  is_error INTEGER,
  result_subtype TEXT,           -- success | error_max_turns | ...
  result_text TEXT,
  num_turns INTEGER,
  duration_ms INTEGER,
  total_cost_usd REAL,
  usage_json TEXT,
  error TEXT,
  event_count INTEGER DEFAULT 0
)

run_events(
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,          -- run 内递增，从 0 开始
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,            -- system | assistant | user | result | stderr
  subtype TEXT,                  -- system 的 subtype: init / hook_started / hook_response
  payload TEXT NOT NULL,         -- 原始 JSONL 行，原样存
  PRIMARY KEY (run_id, seq)
)

CREATE INDEX idx_runs_task ON runs(task_id, queued_at DESC);
CREATE INDEX idx_tasks_next ON tasks(next_run_at);
```

**关键设计：`run_events.payload` 存原始 JSONL 行，写入侧零解析。**
理由：CLI 升级新增事件字段时不会丢数据；写库路径不做字段映射，不拖慢流消费。解析只发生在读取/渲染侧。`runs` 表冗余 `result_*` 字段是为了「任务列表 / 运行历史列表」不必翻事件表。

**没有 `workdir` 字段**（D10）：cwd 是常量，由 `tasksDir()` 提供。历史 run 不带 cwd——若将来改变目录策略，旧 run 的文件引用会失效，这是接受的代价（run 记录的价值主要在事件流本身）。

另有一张 `meta(key, value)` 表存 schema 版本，用于后续 migration。

---

## 4. 模块划分

`src/main/tasks/`：

| 文件 | 职责 | 可测性 |
|---|---|---|
| `db.ts` | `node:sqlite` 的**唯一接触点**：open / PRAGMA / schema migration / close | 薄壳 |
| `store.ts` | 纯 CRUD + 状态机（tasks / runs / run_events），无业务逻辑 | 单测（tmp 目录） |
| `schedule.ts` | **纯函数**：`computeNextRun` / `isDue` / 补跑窗口 / 预设↔cron 模板互转 | 单测（重点） |
| `streamParse.ts` | **纯函数**：`parseStreamLine(line) → ParsedEvent \| null`（行 → 归一化事件），内含 C3 多态归一化与 C1 分组所需的 `messageId` 透出 | 单测 |
| `runner.ts` | 单次 run：spawn + 逐行消费 + 落库 + 推送 + 超时 kill | 逻辑已抽到 `streamParse`，余下薄 |
| `scheduler.ts` | `TaskScheduler` 模块级单例：30s tick、到期判定、队列、并发闸门 | 判定逻辑在 `schedule.ts` |
| `index.ts` | `initTasks(getMainWindow)`：注册 IPC + 启调度器 + 导出 `tasksShutdown()` | — |

`index.ts` 照 `src/main/updater/index.ts` 的 `initUpdater(getMainWindow)` 先例。

把 `schedule.ts` 和 `streamParse.ts` 切成无副作用纯函数是刻意的：它们是唯一有真逻辑、也最容易出错的部分。切成纯函数后，单测不需要 spawn claude、不需要真实时钟。

---

## 5. 执行流（一次 run）

### 5.1 spawn 参数

```
claudeBin = 设置里的 claude_path，回退 spec.command（复用现有 agents 注册表）

args = [
  '-p', task.prompt,
  '--output-format', 'stream-json',
  '--verbose',                                        // 必需，否则直接报错
  '--permission-mode', 'bypassPermissions',
  task.sessionInitialized ? '--resume' : '--session-id', task.sessionId,
]

opts = {
  cwd: tasksDir(),                                    // 常量，见 D10
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
  windowsHide: true,
  env: { ...process.env, CLAUDECODE: undefined },     // 剔除嵌套守卫
}
```

- **`stdio[0] = 'ignore'`（硬要求，不是优化）**：实测 claude 会**等待 stdin 最多 3 秒**再继续，并打印 `Warning: no stdin data received in 3s, proceeding without it.`。`ignore` 让 stdin 立即 EOF，避免每次 run 白等 3 秒；若换成 `pipe` 且不关闭，run 会一直卡住。
- **剔除 `CLAUDECODE`**：从 Claude Code 会话内 spawn 时会被「不能嵌套」守卫挡住。
- **`--resume` 依赖 cwd**（claude 的 jsonl 按 cwd 编码落盘，`~/.claude/projects/<cwd-encoded>/<sid>.jsonl`）。所有任务共用常量 cwd（D10），所以每个任务的 jsonl 都落在同一个 encoded 目录下、按 `session_id` 区分——`--resume` 因此稳定可用。

**tasks 目录的初始化**：启动时若 `tasksDir()` 不存在则 `mkdir -p`，并写入一个极简 `CLAUDE.md`，内容大意是「这是 Lynel 定时任务的工作目录，产物写在这里；要操作其他项目请使用绝对路径」。目的是让 claude 不必每次先 `pwd` 探路。这个文件不覆盖用户手工修改过的版本。

### 5.2 消费

- **stdout 手写缓冲按 `\n` 切行**（不用 `readline`：它会自作主张解析且不保序）。每行→ `parseStreamLine` → `run_events` 落库 → `tasks:runEvent` 推送。
- **不加合帧 batcher**：完整消息粒度下一次 run 只有几十到几百条事件，不需要。`OutputBatcher` 的 API 是按 id 拼字符串的，语义不匹配，硬套反而别扭。若将来开启 partial messages 再补一个按 runId 的合帧器。
- **stdout 必须持续消费**——不读会把 64KB 管道缓冲写满，CLI 直接卡死。
- **stderr 也进流**（`type='stderr'` 事件），前端折叠成「诊断输出」。丢弃诊断信息比多一条事件更可惜。

### 5.3 终态判定

- **以 `result` 事件的 `subtype` / `is_error` 判成败，不以 exit code 判**。已知存在 `subtype=success` + `exit 0` 但实际失败的场景（后台子代理仍在跑）。exit code 只作兜底。
- `result` 事件 → 回填 `runs.result_*`（`result_text` / `num_turns` / `duration_ms` / `total_cost_usd` / `usage_json` / `result_subtype` / `is_error`）。
- 无 `result` 事件但进程退出 → 按 exit code 判 `error`，`error` 字段写入 stderr 尾部。
- 超时 30 分钟 → `killTree()` → `status='timeout'`。
- 收尾回写 `tasks.last_run_at` / `last_status`，推 `tasks:changed`。
- **失败时触发系统通知**（D12）：终态为 `error` / `timeout` / `interrupted` 时调 `windowAttention`（`src/main/attention.ts`）。文案 = 任务名 + 失败原因一行。成功**不通知**。

**手动取消**（`tasks:cancel`）：只对非终态 run 有效，`killTree()` 后标 `status='interrupted'`。与超时共用同一条终止路径。取消**不改变** `nextRunAt`（和「立即执行」一样不碰调度状态）。

**`once` 任务收尾**：执行完成（无论 `done` / `error` / `timeout`）后置 `enabled=0`，**不删除**——保留任务与它的运行历史，用户想再跑一次可以改时间重新启用。超窗未跑则标 `missed` 并同样置 `enabled=0`。

**终止阶梯**：SIGTERM → 等 5s → SIGKILL。复用现有依赖 `tree-kill`（`src/main/dsh.ts:344 killTree()` 的写法）。

### 5.4 resume 回退（已实测）

claude 2.1.114 / `--output-format stream-json --verbose` 三种场景的实测结果：

| 场景 | exit | stdout 里的 `result` 事件 | stderr |
|---|---|---|---|
| `--session-id <新 uuid>`（jsonl 不存在）| 0 | `subtype:"success"` `is_error:false` | — |
| `--resume <sid>`（jsonl 存在）| 0 | `subtype:"success"` `num_turns:1` | — |
| **`--resume <不存在的 uuid>`** | **1** | **`subtype:"error_during_execution"` `is_error:true` `num_turns:0` `total_cost_usd:0`** | `No conversation found with session ID: <uuid>` |

**回退判据（精确、且完全从流里判，不依赖 exit code）：**

```
result.subtype === 'error_during_execution'
  && result.is_error === true
  && result.num_turns === 0
  && 该 run 从未出现过 assistant 事件
```

命中 → 判定「resume 目标缺失」→ 自动用 `--session-id` 重建一次，`session_initialized` 清零，run 上标 `resume_used=0`、`error` 记 stderr 首行。

⚠️ **两个必须遵守的细节：**
1. **那个错误 `result` 里的 `session_id` 是新生成的随机 UUID**（实测 `3f131d29-…`，不是我们请求的那个）。**绝不能把它写回 `tasks.session_id`**——否则下一次 resume 会指向一个空会话，静默丢掉全部上下文。
2. `--session-id` 传非 UUID → exit 1 + stderr `Error: Invalid session ID. Must be a valid UUID.`，无 stdout。我们用 `randomUUID()` 生成所以恒合法，但入库前仍加一道格式校验（防止手工改库）。

这样 jsonl 被删、`~/.claude` 被清、用户手工删过会话都能自愈，且**不需要自己去猜 claude 的 jsonl 路径**（那需要复制一份 cwd 编码逻辑）。副作用是失败时多起一次进程——可接受。

### 5.5 jsonl 隔离（D11）

任务会话的 jsonl 会落在 `~/.claude/projects/<tasks-encoded>/`，与普通会话**同根**。不处理会造成三层冲突：

| 层 | 位置 | 现象 |
|---|---|---|
| 1 | `src/main/jsonl.ts:88` `scanAll()` | 遍历 `rootDir` 下**每一个子目录**读所有 `.jsonl` → 任务会话出现在会话列表里 |
| 2 | `src/main/jsonl.ts:422` `watchProjects()` | chokidar **递归**监听整个 `rootDir`，任务执行期间持续触发重扫 → 列表反复刷新 |
| 3 | 会话列表 → `openTerminal` | 用户点开任务会话 → 因 jsonl 存在而用 `--resume` 起**交互式 PTY**。此时任务进程可能正在用同一 sid 写同一 jsonl → **两个 claude 并发写坏会话文件** |

**做法：Lynel 侧排除，只作用于「枚举」。**

```ts
// jsonl.ts 新增
let excludedProjects = new Set<string>();
export function setExcludedProjects(dirs: string[]): void {
  excludedProjects = new Set(dirs.map(encodeProjectDirName));
}

// scanAll()：跳过排除目录
if (excludedProjects.has(entry.name)) continue;

// watchProjects()：按相对路径首段剪掉整棵子树
ignored: (p) => {
  const rel = path.relative(rootDir, p);
  if (rel) {
    const top = rel.split(path.sep)[0];
    if (excludedProjects.has(top)) return true;
  }
  /* …原有逻辑… */
}
```

`app.ts` 启动时调一次 `setExcludedProjects([tasksDir()])`。

**关键：`listSessionIds(workDir)`（`jsonl.ts:77`）与 `getSessionJsonlPath(sid, workDir)`（`:67`）是按路径直接查、不走枚举**，所以任务自己的 `--resume` 完全不受影响。三层冲突一次性消掉。

**残留（已接受）：** jsonl 文件本身仍在那个目录下，只是 Lynel 不枚举它。claude 自己的 `/resume` 交互式选择器理论上仍可能列出任务会话——但会话是按 cwd 组织的（`-c, --continue` 的说明即 "in the current directory"），而用户不会进 tasks 目录，实际选不到。即便看到也无功能影响。**不为此启用 `CLAUDE_CONFIG_DIR`**（理由见 D11 说明）。

---

## 6. 调度器

模块级单例（照 `src/main/session.ts` / `permission-broker.ts` 的风格）。

**`start()`**：`setInterval(tick, 30_000)` + 启动时立即 tick 一次。
**只用 `croner` 的 `nextRun()` 算时间，不用它自带的 timer**——状态只有 DB 一份真相，所以改任务 / 启停 / 休眠唤醒都不需要重挂 timer。

### 6.1 tick 顺序

1. `store.listEnabledTasks()`
2. 逐个 `isDue(task, now)`：
   - `nextRunAt` 为空 → **只计算落库、不触发**（避免首次启动炸一堆）
   - `now - nextRunAt ≤ 60min` → 到期
   - `now - nextRunAt > 60min` → 跳过并推进 `nextRunAt`；`once` 类型标 `missed` 并置 `enabled=0`
3. **单任务去重**：该 task 已有非终态 run → 跳过（不建新 run，也不推进 `nextRunAt`，下个 tick 再看）
4. 到期的 → **建 run（`queued`）+ 推进 `nextRunAt`**（先落库再入队，崩溃恢复靠它）
5. `drain()`：`activeRuns < maxConcurrency` 则出队；出队时 `now - queuedAt > 30min` → 标 `skipped` 不入队

`nextRunAt` 的**正常来源是创建/编辑任务时立即计算并落库**（这样表单预览和列表里的「下次运行」立刻可见）。第 2 步的「空值只计算不触发」只是安全网，覆盖 DB 被手工编辑或将来 migration 的情况。

### 6.2 启动恢复

App 启动时**只做一次**：
- `status='running'` 的 run → 标 `interrupted`
- `status='queued'` 的 run → **重新入队**（而不是丢弃）

即崩溃时排队的任务不会凭空消失。DB 里所有非终态 run 都会在启动后拿到明确归宿。

### 6.3 并发上限

读 `getStore('settings')` 的 `tasks_max_concurrency`，默认 6。

---

## 7. IPC

```
tasks:list            → TaskRow[]
tasks:get             (id) → TaskRow
tasks:create          (input) → TaskRow
tasks:update          (id, patch) → TaskRow
tasks:delete          (id) → void
tasks:setEnabled      (id, enabled) → void
tasks:runNow          (id) → runId
tasks:runs            (taskId, {limit, before}) → RunRow[]       // 分页
tasks:run             (runId) → RunRow
tasks:runEvents       (runId, {afterSeq}) → NormalizedEvent[]    // 增量拉取；已在主进程解析（见 §8.4 解析边界）
tasks:cancel          (runId) → void
tasks:preview         (schedule) → { nextRuns: number[] }        // 未来 3 次
```

推送（`webContents.send`）：

| channel | 时机 |
|---|---|
| `tasks:changed` | 任务表任何变动（增删改/启停/`last_status` 回写） |
| `tasks:runChanged` | 某 run 状态变化（queued → running → done/…） |
| `tasks:runEvent` | 流式追加事件（`{ runId, events: EventRow[] }`） |

---

## 8. UI

### 8.1 入口与 tab

- `src/renderer/src/views/HomeView.vue` 左栏，**收藏夹按钮（`:52-57`）之前**插入「任务」按钮。结构照抄收藏夹：`<button class="home-entry tooltip-wrap">` + `<Icon>` + `.entry-label` + `.tooltip`。折叠态（`:80-88` 区域）照 `onCollapsedFav`（`:617-621`）补一个「先展开侧栏再开 tab」的 handler。
- **做成 tab，不是内联展开面板**。收藏夹做成内联展开是因为它列的是「会话」——点开要在已有会话 tab 里打开；而任务是一个完整功能页（列表 + 详情 + 流水），与首页/设置/使用指南/Harness 同级。这也符合既有取向：新功能并入既有并列交互，不做特殊模式。
- 三处改动：
  - `src/renderer/src/types/tab.ts:1` — `TabType` 加 `'tasks'`
  - `src/renderer/src/stores/tabs.ts` — 加 `openTasks()`（照 `openGuide` `:54-56`）
  - `src/renderer/src/components/GlobalTabs.vue:14-18` — 图标映射加分支
- **图标**：先查 `Icon.vue` 的 `icons` 映射是否已注册 `alarm-clock` / `list-checks`；未注册按现有风格补（import 一行 + 映射一行）。禁止 emoji / Unicode 符号当图标。

### 8.2 页面结构

`src/renderer/src/components/tasks/TasksPane.vue`，三段式，与 `TracePane.vue` 同构：

- **左栏**：固定像素宽可拖（照 GitPanel 存 `localStorage` 的做法）。
- **顶部工具条**：只有两个常驻控件——`[+ 新建任务]` 与一行**内嵌图标的搜索框**；`[筛选]` 按钮点开是**浮层下拉**（状态单选：全部/启用/停用/上次失败 + 分隔线 + `[全部启用] [全部停用]`）。浮层不占位，收起时左栏只有两行元素位。
- **任务行（两行）**：
  ```
  ● 每日 CI 失败巡检                    ← 行1：状态点 + 名称（+ hover 才淡入的启停图标）
    每天 09:00 · 下次 明天 09:00         ← 行2：调度摘要 · 下次运行
  ```
  - **启停不用常驻开关**——iOS 式 pill switch 每行都挂一个视觉噪音太大。改为**靠颜色区分**：启用行文字正常色，**停用行整行转灰**（名称 `--text-tertiary` 且字重降为 400、摘要进一步降透明度）。
  - 状态点缩到 6px，只承担颜色语义：`--status-success` 启用 / `--text-tertiary` 半透明停用 / `--accent` 运行中（带 glow）/ `--status-error` 上次失败。
  - **启停按钮 hover 或该行被选中时才淡入**（纯图标 `power`，无边框），默认不可见。
- **排序默认按 `nextRunAt` 升序**，停用/无下次的沉底并归入「已停用 / 已过期」分组标题下。任务多时这是唯一有意义的排序。
- **右栏**：`TaskDetailPane.vue`。其头部操作同理收敛为一个 primary（`立即执行`）+ 两个 ghost 图标按钮（`编辑` / `删除`），不是三个同权重按钮。

### 8.3 任务详情

`TaskDetailPane.vue`：

- 上半：名称 / 调度摘要 / 下次运行 / 上次结果 + 操作（立即执行、编辑、删除）。**不显示工作目录 / 项目**（D10）
- 下半：**运行历史**（runs 倒序分页）：状态徽标 · trigger(`scheduled`/`manual`) · 开始时间 · 耗时 · 轮数 · 成本 · 结果摘要一行
- 点某次 run → 进 `RunStreamView.vue`

### 8.4 运行流水的数据契约（实测）

**本节结论来自真实运行**：`claude -p "…" --output-format stream-json --verbose --permission-mode bypassPermissions`，claude **2.1.114**，一次带 Bash 调用的完整往返共 **9 行**。样本原文与逐行结构记录在配套 HTML 设计稿第 3 节。以下 5 条是实测**推翻**了初始假设的地方，渲染层必须照此实现：

| # | 实测事实 | 实现要求 |
|---|---|---|
| C1 | **`assistant` 是「一个 content block 一行」**，同一 `message.id` 跨多行（样本 4 条 assistant 行只有 2 个 `message.id`） | 先按 `message.id` 分组才是「一条消息」；**不能按行边界切消息** |
| C2 | **`tool_use.id` 不带 `toolu_` 前缀**：实测 `call_00_1wClu5X4x87ixrpzM3Wr1570`（因 base_url 指向第三方） | 显示只取末 4–8 位；配对只做等值比较；**不假设前缀，不按固定长度截断** |
| C3 | **`tool_result.content` 多态**：实测为纯字符串（`"total 724\n…"`），也可能是 block 数组或 `null` | 三态归一化后再渲染 |
| C4 | **`system` 事件不止 `init`**：实测流**开头两行**是 `hook_started` + `hook_response`（全局 settings 的 `SessionStart` hook 在无头下照样触发） | 降级成一行摘要，**不能当未知事件丢弃** |
| C5 | **`usage` 不是扁平 token map**：含嵌套对象 `server_tool_use{}` / `cache_creation{}` / `iterations[]` 与字符串字段 `service_tier` / `speed` / `inference_geo` | 按白名单挑数值字段；直接 `Object.entries` 会渲染出一堆 `[object Object]` |

另外三个实测细节：
- **空的 thinking block 真实存在**（`{"type":"thinking","thinking":"","signature":"…"}`）→ 必须过滤，否则渲染空卡片
- **`system/init` 有 16 个字段**，其中 `mcp_servers` 会带 `{name, status:"failed"}` → 应作为警告提示用户（实测 `tma1` 就是 failed）
- **一次 `ls -la` 就花了 $0.165**（input 28,493 tokens，其中 cache_read 28,416）→ 成本必须显眼，每个 run 都要显示

`system/init` 实测字段：`cwd` / `session_id` / `tools` / `mcp_servers` / `model` / `permissionMode` / `slash_commands` / `apiKeySource` / `claude_code_version` / `output_style` / `agents` / `skills` / `plugins` / `uuid` / `memory_paths` / `fast_mode_state`。
`result` 实测字段（比预期多）：`subtype` / `is_error` / `api_error_status` / `duration_ms` / `duration_api_ms` / `num_turns` / `result` / `stop_reason` / `session_id` / `total_cost_usd` / `usage` / `modelUsage` / `permission_denials` / `terminal_reason` / `fast_mode_state` / `uuid`。
`user` 事件顶层**多两个字段**：`timestamp` 与 `tool_use_result`（Bash 的结构化结果，含 `stdout`/`stderr`，比 `content` 的纯字符串更有用）。

**解析边界（重要，避免两份解析器）：** 主进程与渲染进程是两个独立 bundle，**不能互相 import**。所以 C3 的多态归一化与「原始行 → 结构化事件」全部落在主进程的 `streamParse.ts`，`tasks:runEvents` IPC **返回归一化后的事件对象、而不是原始字符串**；渲染层的 `flattenRunEvents` 拿到的已经是结构化数据，只负责 C1 分组、空 thinking 过滤、tool_use↔tool_result 配对、StepCard 摘要映射。`run_events.payload` 照旧存原始行（保真），解析只发生在**读取时**。

### 8.5 运行流水渲染（核心新组件）

`RunStreamView.vue` 用纯函数 `flattenRunEvents(events) → StreamItem[]` 把原始事件流折叠成线性条目：

| 事件 | 渲染 |
|---|---|
| `system` / `init` | 一行元信息：版本 · model · cwd · 工具数 ·（有 MCP 失败则附警告 chip） |
| `system` / `hook_started`+`hook_response` | 降级成一行「SessionStart hook · 成功（N 条已折叠）」 |
| `assistant` 的 `thinking` block（**按 `message.id` 分组后**）| 折叠块「思考」，默认收起；**空 thinking 直接丢弃** |
| `assistant` 的 `text` block | `Markdown.vue` |
| `assistant` 的 `tool_use` block | **折叠成一行 StepCard**（见下） |
| `user` 的 `tool_result` block | 按 `tool_use_id` 回填到对应 StepCard 的展开区，失败用 `--status-error` |
| `result` | 终局卡片：状态 · 耗时 · 轮数 · 成本 · token 明细 · 最终文本 |
| `stderr` | 折叠的「诊断输出」块 |

**工具 StepCard（默认折叠成一行）**——这是实测 + 外部案例共同指向的做法：几十个工具调用全展开是不可读的。一行内容 = 折叠箭头 + 工具名 + **关键参数摘要** +（Edit/Write 的 `+N −M`）+ 状态徽标（成功 ✓ / 失败 ✗ / 运行中 ◐，运行中仅出现在最后一个未配对的 `tool_use`）。点击展开显示入参与输出。

关键参数摘要映射：

| 工具 | 摘要 |
|---|---|
| `Bash` | `command` |
| `Read` | `file_path` + `:offset-limit` |
| `Edit` | `file_path`，右侧加 `+N −M` 行数 |
| `Write` | `file_path`，右侧加 `+N` |
| `Glob` / `Grep` | `pattern`（Grep 附 `path`） |
| `TodoWrite` | `N 项任务` |
| `Task` | 子代理描述 |
| `WebFetch` | `url` |
| `WebSearch` | `query` |
| `AskUserQuestion` | 第一个问题文本 |
| 其他 | 第一个字符串字段的值，都没有则不显示摘要 |

**默认展开的例外**：`Edit` / `Write` 的 diff **默认展开**——改动是任务的核心产出，折叠了还得点一次。失败的工具调用也默认展开。

**按元素显隐开关**：流顶部一排 toggle（照 `@fnclaude/renderer` 的做法，切换即时重绘）：
`思考` · `工具入参` · `工具输出` · `仅错误` · `子代理`。
这是流水可读性的必需品，不是锦上添花。

**子代理**：`parent_tool_use_id !== null` 的事件来自子代理，渲染成缩进块并标注「子代理 · <名字>」（`Task` 工具的入参里有 `subagent_type`）。

**复用**：`src/renderer/src/types/blocks.ts` 的 `ContentBlock` 类型——它的文件头注释已写明「Claude CLI stream-json 输出的 message.content 可能是字符串或 content block 数组」，本来就是为这个场景定义的。渲染手法照抄 `components/trace/detail/ResponsePane.vue`（Markdown / FoldingPre / `useIdHue` 配对配色）。

**不直接复用 `ResponsePane.vue`**：它的 props 形状是 proxy 的 `detail.reassembled`，且带 usage 网格，语义不同。

`flattenRunEvents` 放 `src/renderer/src/utils/tasks.ts`，签名是 `flattenRunEvents(events: NormalizedEvent[]) → StreamItem[]`——**输入是主进程 `streamParse` 归一化后的事件，不是一个字符串数组**（见 §8.4 末尾的解析边界说明；C3 已在主进程做完）。它只做 C1 分组、空 thinking 过滤、配对、StepCard 摘要映射，是纯函数，Vue 组件不碰这段逻辑。

测试放 `tests/main/tasks/flatten.test.ts`：那里可以同时 import 主进程的 `streamParse` 和渲染层的 `flattenRunEvents`，于是能用**真实 fixture** 驱动「解析 → 折叠」整条链路。

**运行中实时**：`status === 'running'` 时订阅 `tasks:runEvent` 增量追加（先 `tasks:runEvents({afterSeq})` 拉一次补齐，再靠推送）。底部自动跟随；用户手动上滚则停止跟随（详情页流水的标准交互）。

### 8.6 新建 / 编辑表单

`TaskFormDialog.vue`：

- 名称 / prompt（多行）。**无工作目录、无项目、无 agent 选择器**（见 D10 / D9）
- prompt 输入框下方一行辅助说明：**「任务在固定的任务目录中运行；要操作其他项目请在 prompt 里写绝对路径。」**——这是 D10 后果 ③ 的唯一提示位，不写用户会以为相对路径能生效
- **调度**：预设 radio + 可切「自定义 cron」。预设与其生成的表达式一一对应：

  | 预设 | 参数 | 生成的 cron |
  |---|---|---|
  | 每天 | 时:分 | `M H * * *` |
  | 每周 | 星期几（多选）· 时:分 | `M H * * 1,3,5` |
  | 每月 | 几号（1–31）· 时:分 | `M H D * *` |
  | 每小时 | 第几分 | `M * * * *` |
  | 每 N 分钟 | N（1–59） | `*/N * * * *` |
  | 一次性 | 日期时间 | 不走 cron，落 `schedule_type='once'` + `run_at` |

  - 预设是**表达式构造器**：选预设 → 拼出 cron 回填到表达式框
  - 编辑已有任务时按**上表模板精确反查**回填预设；查不到（用户手填的表达式，或含 `L`/`#`/`?` 等扩展语法）落「自定义」模式
  - 底层**只存 cron**，预设层纯属 UI，不落库——数据库里没有第三份语义
- **实时预览**：填完立刻调 `tasks:preview` 显示「接下来 3 次运行时间」。这是 cron 表达式最好的合法性校验兼回显——比引 `cronstrue` 做中文描述更有效，且零依赖。非法表达式由 `croner` 构造时抛错，表单就地标红。
- **警示行**：「定时任务无人值守运行，将以完全权限执行，请确认任务内容可信。」

约束：`每 N 分钟` 的 N 限 1–59（cron 无法表达「每 90 分钟」）；删「每周」的星期几全不选、「每月」的几号超 1–31 都要在表单层拦掉。

---

## 9. 生命周期挂载点

**启动**（`src/main/app.ts`，`registerIpcHandlers()` 附近），顺序固定：

1. `mkdir -p tasksDir()` + 写入初始 `CLAUDE.md`（若不存在）
2. **`jsonl.setExcludedProjects([tasksDir()])`** ← 必须在任何会话扫描之前执行，否则首次列表会带上任务会话
3. `initTasks(getMainWindow)`：开库 / migration / 恢复非终态 run / 注册 IPC / 启动调度器

**退出**（`app.ts:639`，`dshManager.shutdown()` 之后、「shutdown complete」日志之前）：`await tasksShutdown()`
1. `clearInterval`
2. 对每个在跑 run `killTree(proc)`
3. 回写 `status='interrupted'`
4. `db.close()`

---

## 10. 依赖与配置

| 包 | 用途 | 备注 |
|---|---|---|
| `croner@10` | cron 表达式 → 下次运行时间；构造时校验合法性 | **零依赖**，151KB。对比 `cron-parser@5` 会拖一个 `luxon`（~3MB） |
| `node:sqlite` | 存储 | 内置，非新增依赖 |

新增设置项（都走 `getStore('settings')`）：

| key | 默认 | 说明 |
|---|---|---|
| `tasks_max_concurrency` | `6` | 全局同时在跑的 run 上限 |
| `tasks_dir` | `~/.lynel-desktop/tasks/` | 所有任务共用的工作目录（D10）。**不要**给默认值指向安装目录——macOS 会破坏 `.app` 签名、electron-updater 升级会原地替换导致数据丢失、asar 内只读 |

---

## 11. 文件变更清单

### 11.1 主进程（新增）

| 文件 | 内容 |
|---|---|
| `src/main/tasks/db.ts` | sqlite 封装 + schema migration |
| `src/main/tasks/store.ts` | CRUD + 状态机 |
| `src/main/tasks/schedule.ts` | 纯函数：nextRun / isDue / 预设模板 |
| `src/main/tasks/streamParse.ts` | 纯函数：NDJSON 行解析 |
| `src/main/tasks/runner.ts` | spawn + 消费 + 落库 + 推送 |
| `src/main/tasks/scheduler.ts` | tick + 队列 + 并发 |
| `src/main/tasks/index.ts` | `initTasks()` / `tasksShutdown()` / IPC 注册 |

### 11.2 主进程（修改）

| 文件 | 改动 |
|---|---|
| `src/main/app.ts` | 启动时建 tasks 目录 + `setExcludedProjects()` + `initTasks()`；shutdown 时 `await tasksShutdown()` |
| `src/main/jsonl.ts` | 新增 `setExcludedProjects()`；`scanAll()`（`:88`）跳过排除目录；`watchProjects()`（`:422`）的 `ignored` 按相对路径首段剪枝 |
| `src/main/preload.ts` | 暴露 `tasks*` 方法 |
| `package.json` | 新增 `croner` 依赖 |

### 11.3 前端（新增）

| 文件 | 内容 |
|---|---|
| `src/renderer/src/components/tasks/TasksPane.vue` | 三段式主面板 |
| `src/renderer/src/components/tasks/TaskList.vue` | 左栏任务列表 + 筛选/搜索/批量启停 |
| `src/renderer/src/components/tasks/TaskDetailPane.vue` | 任务详情 + 运行历史 |
| `src/renderer/src/components/tasks/TaskFormDialog.vue` | 新建/编辑表单 |
| `src/renderer/src/components/tasks/RunStreamView.vue` | 运行流水渲染（含 StepCard、显隐开关） |
| `src/renderer/src/components/tasks/ToolStepCard.vue` | 单个工具调用的折叠卡片 |
| `src/renderer/src/stores/tasks.ts` | Pinia store |
| `src/renderer/src/utils/tasks.ts` | **`flattenRunEvents(NormalizedEvent[])`**（C1 分组 / 空 thinking 过滤 / 配对 / StepCard 摘要映射）+ 调度摘要文案。**不做 NDJSON 解析**——输入已是主进程归一化后的事件（解析边界见 §8.4） |
| `src/renderer/src/types/tasks.ts` | 渲染侧类型（与主进程 store 的 row 形状对应）+ `StreamItem` |

### 11.4 前端（修改）

| 文件 | 改动 |
|---|---|
| `src/renderer/src/views/HomeView.vue` | 左栏「任务」入口（收藏夹之前）+ 折叠态 handler + 内容区 pane |
| `src/renderer/src/types/tab.ts` | `TabType` 加 `'tasks'` |
| `src/renderer/src/stores/tabs.ts` | 加 `openTasks()` |
| `src/renderer/src/components/GlobalTabs.vue` | 图标映射加分支 |
| `src/renderer/src/components/Icon.vue` | 注册任务图标（若缺） |
| `src/renderer/src/composables/useElectron.ts` | 封装 `tasks*` IPC |

### 11.5 测试（新增）

| 文件 | 覆盖 |
|---|---|
| `tests/main/tasks/schedule.test.ts` | 各预设/各 type 的 `computeNextRun`；`isDue` 补跑窗口边界（59m59s / 60m0s / 60m1s）；`once` 超窗；**预设↔cron 互转往返**（遍历全部模板） |
| `tests/main/tasks/store.test.ts` | tmp 目录建库；CRUD；run 状态机；启动恢复（`running→interrupted`、`queued` 保留） |
| `tests/main/tasks/streamParse.test.ts` | 空行、非法 JSON 行、每种 type、**未知 type**、超大行、`\r\n`；**C3 三态**（`tool_result.content` 为 string / array / null）；**C4**（`hook_started`+`hook_response` 不被丢）；空 thinking block 被过滤 |
| `tests/main/tasks/flatten.test.ts` | `flattenRunEvents`：**C1 按 `message.id` 分组**（同一 id 多行合成一条消息）、工具配对（`tool_use.id` ↔ `tool_result.tool_use_id`，含 C2 非 `toolu_` 前缀）、StepCard 摘要映射（逐工具）、子代理缩进（`parent_tool_use_id` 非 null）、**C5 usage 白名单**（嵌套对象不被当数值） |
| `tests/main/tasks/fixtures/stream-sample.jsonl` | **真实样本 fixture**（9 行 / 4.9 KB，2026-09-18 本机 claude 2.1.114 实测捕获，一次带 Bash 工具往返的完整流）。**已脱敏**：session id / uuid 换成固定值、cwd 与 memory_paths 换成占位、`hook_response.output` / thinking / text / result.result 内容换成占位、`tools`/`skills`/`agents`/`plugins` 数组截断到前几条。**保留全部形状特征**，逐项自检通过：C1（4 条 assistant 行 / 2 个 id）、C2（`call_00_…`）、C3（content 为字符串）、C4（hook_started+hook_response）、C5（usage 含嵌套对象）、空 thinking block、`mcp_servers: [{name:"tma1",status:"failed"}]` |

**不测真跑 claude**（成本 + 不稳定）。有逻辑的部分已被三个纯函数模块抽走。测试照 `tests/main/favorites.test.ts:16-21` 的模式：tmp 目录 + `vi.mock('electron')`。

**两处测试落位说明：**
1. `flattenRunEvents` 是渲染层的纯函数（`src/renderer/src/utils/tasks.ts`），但它的测试放 `tests/main/tasks/flatten.test.ts` 用根 vitest 跑——因为它不依赖 Vue/浏览器，直接相对路径 import 即可。这样**不必启用渲染进程的 vitest**（`src/renderer/package.json` 的 `test` 脚本目前是 `echo "no tests yet"` 占位符），也就不会改变 CLAUDE.md 里「commit 前跑 `npm run test:main` + `vue-tsc --noEmit`」的既有验证流程。代价是 `tests/main/` 镜像 `src/main/` 的约定被轻微打破，属有意取舍。
2. C1/C3/C5 这三个坑**必须有测试钉住**——CLI 升级时它们是静默失效的，不会报错，只会渲染出错误的内容。

---

## 12. 实现前必须验证的风险点

| # | 风险 | 状态与验证方式 | 兜底 |
|---|---|---|---|
| R1 | ~~`node:sqlite` 在 Electron 主进程能否 require~~ | **已实测消除**：Electron **43.0.0** / Node **24.17.0** 下 `require('node:sqlite')` 成功，exports 为 `DatabaseSync` / `StatementSync` / `Session` / `constants` / `backup`；`DatabaseSync` + `exec` / `prepare` / `run` / `all` / `get` / `close` 全部跑通，`PRAGMA journal_mode=WAL` 返回 `wal`，写入-读取往返正确 | **不需要** `better-sqlite3`。`db.ts` 仍保持单点封装，作为将来 API 变动的隔离层 |
| R2 | ~~`--resume` 指向不存在的 jsonl 的失败特征~~ | **已实测消除**：见 §5.4 三种场景对照表。判据完全从流里的 `result` 事件得出，不依赖 exit code | — |
| R3 | ~~`-p` 是否等 stdin EOF~~ | **已实测**：会等**最多 3 秒**并打印 `Warning: no stdin data received in 3s…`。`stdio[0]='ignore'` 让 stdin 立即 EOF，规避等待 | 硬要求 `ignore`；用 `pipe` 且不关闭会**永久卡住** |
| R4 | ~~全局 hooks 在无头下是否生效~~ | **已实测证实生效**：真实流**开头两行**就是 `hook_started` + `hook_response`（SessionStart）。未观察到报错或明显拖慢（实测总耗时 10.0s） | 渲染层按 C4 降级成一行；若某次 hook 指向的服务不在，`hook_response` 的 `exit_code`/`outcome` 会体现，UI 上提示 |
| R5 | ~~`result` 事件字段~~ | **已实测**：字段清单见 §8.4，`subtype=success` / `terminal_reason=completed` / `total_cost_usd` 均确认存在 | `runs` 表只回填已知字段，未知字段仍在 `run_events` 原始行里，不丢 |
| R6 | **`--verbose` 在某些版本会吐「累积快照」，导致同一内容重复出现**（外部案例把这条列为已知坑，`claude-code-parser` 为此专门做了 stateful `Translator` 去重）。本机 2.1.114 实测 9 行**未出现**重复 | 待验证：实现后拿一个工具调用较多的真实 run，检查同一 `message.id` + 同一 block 是否出现两次 | 在 `flattenRunEvents` 里按 `message.id` + block 内容哈希去重（纯函数内做，易单测） |
| R7 | **多 agent 在同一 stdout 上交错**（`parent_tool_use_id` 标识来源）。若任务 prompt 触发 `Task` 子代理，主/子代理的事件会混在一条流里 | 待验证：跑一个会派子代理的任务，观察交错顺序 | 按 `parent_tool_use_id` 分组缩进；必要时把子代理整体折成一块 |
| R8 | **`node:sqlite` 是 experimental API**，跨 Electron 升级可能变。实测已出 `ExperimentalWarning` 到 stderr | 升级 Electron 时重跑 R1 的探测脚本 | `db.ts` 单点隔离；必要时换 `better-sqlite3`（改 `pnpm.onlyBuiltDependencies` + `electron-builder.yml` 加 `asarUnpack` + 4 平台 rebuild） |

---

## 13. 明确不做（YAGNI）

- 不支持自动重试 / 退避
- 不支持「向已有会话发消息」动作（只支持起新会话执行 prompt）
- 不支持 `--include-partial-messages` 逐字流
- 不支持工作日/季度/月底等复杂日历语义（cron 表达式本身能表达的除外）
- 不做任务模板 / 任务间依赖 / 任务分组
- 不把任务流量接入 apiproxy / Trace / 云通道
- **不做任务会话 jsonl 的清理**（D10 后它们固定落在 `~/.claude/projects/<tasks-encoded>/`，每个任务一个文件，长期累积）。将来可加「保留最近 N 次」的清理任务
- **不用 `--add-dir` 让任务操作目标项目**（会把目录概念请回来，见 D10 后果说明）
- **不用 `CLAUDE_CONFIG_DIR`**（会破坏 D1 与插件/skills/memory，见 D11 说明）
- 不做任务分组 / 标签 / 拖拽排序
