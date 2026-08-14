# 模型供应商页按 Agent 差异化设计

## 背景

`src/main/agents/` 已落地 AgentKind 抽象（claude/codex/opencode/omp），多 Agent 前端 UI（`2026-08-09-multi-agent-ui-design.md`）已在 ProviderTab 落地"按 agent 分组"框架：左侧 4 个 agent badge 切换 + 右侧供应商表单。但三个新 agent（codex/opencode/omp）完全复用 claude 的 ANTHROPIC_* 表单（base_url/auth_token/默认模型/haiku/sonnet/opus/reasoning_model），字段与各自配置载体不匹配。本文档定义三个新 agent 的独立供应商表单设计，参考 cc-switch（`farion1231/cc-switch`）每工具独立表单的交互模式。

## 目标

1. 三个新 agent（codex/opencode/omp）拥有各自独立的供应商配置表单，字段与配置载体匹配
2. 三个新 agent 支持"设为当前"（完整激活），主进程按各自载体持久写入
3. 激活状态 per-agent 独立（`active_providers: Record<AgentKind, string>`）
4. UI 重构为 cc-switch 风格：顶部 agent 切换 + 卡片式供应商列表 + 对话框式添加/编辑
5. 不引入 cc-switch 的 OAuth / 端点测速 / 模型目录 / extra options / API Format（主进程 openai/pi adapter 为空壳，无法落地）

## 决策记录

| # | 问题 | 决策 |
|---|---|---|
| 1 | 激活语义 | **A 完整激活**：三个新 agent 也能"设为当前"，主进程按各自载体持久写入 |
| 2 | 字段粒度 | **按 agent 差异化字段**（参考 cc-switch 每工具独立表单），但受限于主进程可落地写入 |
| 3 | UI 布局 | **cc-switch 风格**：顶部工具切换 + 卡片式供应商列表 + 对话框式添加/编辑 |

## 现状分析

### 前端

- `ProviderTab.vue`：左侧 4 个 agent badge（`AgentBadge` sm）切换 + 供应商列表，右侧内嵌表单。三个新 agent 复用 claude 的 7 字段。
- `types/providers.ts`：`Provider` 扁平结构，只有 claude 的字段。
- `stores/providers.ts`：`active_provider_id` 全局单值；`setActive` 后 `SaveProvidersConfig` 触发主进程 `applyActiveProvider`。
- "设为当前"按钮 `:disabled="provider.id === activeId || selectedAgent !== 'claude'"`——非 claude 禁用。

### 主进程

- `app.ts applyActiveProvider` 只处理 claude：写 `~/.claude/settings.json` 的 `ANTHROPIC_*` env。
- session 启动注入（`buildAgentInjection`）三个新 agent 走动态注入，**不消费 active_provider_id**：
  - codex：`-c model_providers.<name>.base_url="<proxyUrl>"` 覆盖 config.toml，env 兜底 `OPENAI_BASE_URL`。
  - opencode：写临时 `OPENCODE_CONFIG`，覆盖 `provider.opencode-go` / `provider.opencode` 的 `options.baseURL`。
  - omp：写 `~/.omp/agent/models.yml` 的 `providers.deepseek.baseUrl`（override-only），session 退出恢复原文件。

## 数据模型

```ts
export type AgentKind = 'claude' | 'codex' | 'opencode' | 'omp'

export interface Provider {
  id: string
  agent?: string            // 缺省 'claude'
  name: string
  base_url: string
  auth_token: string
  default_model: string
  // claude 专属（现有保留）
  default_haiku_model?: string
  default_sonnet_model?: string
  default_opus_model?: string
  reasoning_model?: string
  // codex 专属
  codex_provider?: string   // config.toml 里 model_providers 的 key，默认 'lynel'
}

export interface ProvidersConfig {
  active_providers: Record<AgentKind, string>   // 新：per-agent 激活
  active_provider_id?: string                    // 旧字段，读取时迁移
  providers: Provider[]
}
```

## 差异化字段清单

| Agent | 表单字段 | "设为当前"写入载体 |
|---|---|---|
| claude | 现有 8 字段（不变）：名称 / Base URL / Auth Token / 默认模型 / Haiku默认模型 / Sonnet默认模型 / Opus默认模型 / 推理模型 | `~/.claude/settings.json` env |
| codex | 名称 / Base URL / API Key / 默认模型 / Provider 名（model_providers 的 key，默认 `lynel`） | `~/.codex/config.toml` 的 `[model_providers.<name>]` |
| opencode | 名称 / Base URL / Auth Token / 默认模型 | `~/.config/opencode/opencode.json` 的 `provider.opencode-go` |
| omp | 名称 / Base URL / Auth Token / 默认模型 | `~/.omp/agent/models.yml` 的 `providers.deepseek` |

共用交互：URL/Token 输入 600ms debounce 拉取模型下拉（复用 `FetchProviderModels`）；测试连接复用 `TestProviderConnection`（先试 Anthropic 再试 OpenAI 格式）。

## 主进程激活写入

`applyActiveProvider` 改为遍历 4 个 agent，按 `active_providers[agent]` 找到对应 provider 分派写入：

| Agent | 写入实现 |
|---|---|
| claude | 现有逻辑（settings.json env）不变 |
| codex | 文本级合并 `~/.codex/config.toml`：确保 `[model_providers.<name>]` 段存在，写 `base_url` + `api_key`（base64，对齐 codex 格式），设顶层 `model`；复用现有正则读取。不引入 TOML 依赖 |
| opencode | JSON 合并 `~/.config/opencode/opencode.json` 的 `provider.opencode-go.options`：`baseURL` / `apiKey` / `models` |
| omp | 复用 `mergeOmpDeepseekBaseUrl` 持久写 `providers.deepseek.baseUrl`，追加 `apiKey` |

## 数据迁移

- `GetProvidersConfig` 读取时：若 `active_providers` 缺失，从旧 `active_provider_id` 迁入 `active_providers.claude`。
- 旧 Provider 对象无 `agent` 字段 → 缺省 `claude`（沿用现有逻辑）。
- 向后兼容：旧数据读取后即可正常增删改。

## UI 布局与组件（cc-switch 风格）

```
ProviderTab（设置页内）
├── .header 顶部工具条
│   ├── AgentSwitch ── 4 个 agent badge 横向切换
│   └── [ + 新增供应商 ] 按钮
├── .card-grid 供应商卡片网格（2 列，响应式）
│   ├── ProviderCard × N
│   │   ├── 头部：名称 + AgentBadge + 「当前」徽标（激活高亮边框）
│   │   ├── 主体：Base URL（单行截断）+ 默认模型
│   │   └── 底部操作：设为当前（非激活时）/ 编辑 / 删除
│   └── [ + ] 虚线加号卡片（点击新增）
└── ProviderDialog（Teleport modal，Add/Edit 复用）
    ├── 标题：新增供应商 / 编辑供应商
    ├── 表单：按 agent 差异化动态渲染
    ├── 测试连接按钮
    └── 底部：取消 / 保存
```

### 组件拆分

| 文件 | 说明 |
|---|---|
| `ProviderTab.vue`（重构） | 顶部工具条 + 卡片网格 + 对话框编排 |
| `ProviderCard.vue`（新增） | 单个供应商卡片，展示 + 操作 |
| `ProviderDialog.vue`（新增） | 添加/编辑对话框，按 `agent` 动态渲染字段 |
| `AgentBadge.vue`（复用） | agent 标识 |

### 行为细节

- **per-agent 激活**：切到某 agent 分组显示该组激活卡片；"设为当前"只改 `active_providers[agent]`。
- **删除兜底**：组内最后一个被删时自动补一个空 provider 并设为激活（沿用现有 store 逻辑）。
- **空状态**：无供应商时显示「暂无供应商，点击上方 + 新增」。
- 表单字段渲染按 agent 分派：claude 渲染 8 字段（名称 + 7 个配置项），codex 渲染 5 字段（含 Provider 名），opencode/omp 渲染 4 字段。

## 激活与 Lynel 会话转发的关系

Lynel 会话始终走本地代理（proxyUrl），代理再转发到 upstream：
- **claude / codex**：upstream 读自激活写入的文件（settings.json / config.toml），激活供应商 = 会话转发目标，自洽。
- **opencode / omp**：upstream 固定 `spec.upstream`（opencode.ai 网关 / api.deepseek.com），激活只影响 agent **独立运行**（不在 Lynel 里跑时）。Lynel 会话仍转固定网关。本次**不引入** `resolveUpstream` 改造（保持现状）。

## IPC / preload

IPC 名称不变（`GetProvidersConfig` / `SaveProvidersConfig` / `applyActiveProvider`），仅数据结构扩展。preload 不动。

## 测试策略

- **主进程单测**（`tests/main/`）：
  - `applyActiveProvider` 各 agent 分派写入（mock store，验证目标文件内容）。
  - `active_provider_id` → `active_providers` 迁移。
- **前端**：`vue-tsc` 类型检查（renderer vitest 仍为占位符）。

## 明确不做（YAGNI）

- cc-switch 的 OAuth 登录、端点测速、模型目录、extra options、API Format 转换。
- `resolveUpstream` 改造（opencode/omp 激活不改变 Lynel 会话转发目标）。
- 引入 TOML 依赖（codex 写入走文本级合并）。

## 实施顺序

1. 前端类型：`types/providers.ts` 扩展（`active_providers`、`codex_provider`）
2. 前端 store：`stores/providers.ts` 适配 per-agent 激活 + 数据迁移读取
3. 主进程：`applyActiveProvider` 按 agent 分派（codex config.toml / opencode opencode.json / omp models.yml 写入）
4. 主进程：`GetProvidersConfig` 迁移旧 `active_provider_id`
5. UI：`ProviderCard.vue` / `ProviderDialog.vue` 组件
6. UI：`ProviderTab.vue` 重构为顶部工具条 + 卡片网格
7. 回归：`npm run test:main` + `cd src/renderer && npx vue-tsc --noEmit`
