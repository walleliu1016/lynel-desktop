# 通用设置 Agent 路径配置与 agent 标识优化设计

日期：2026-08-13

## 背景

`src/renderer/src/components/settings/GeneralTab.vue` 中 4 个 agent（claude / codex / opencode / omp）的路径配置各占「label + input + hint」三行，共 12 行，占据通用设置页面大半空间。路径属于低频配置（留空即用 PATH）。同时模型供应商页（`ProviderTab.vue`）的 agent 切换仍用 CC/CX/OC/PI 字母缩写，与会话列表侧的实际 logo 不统一。

## 方案

两处统一为「Agent Tab 切换」：通用设置路径区改为 4 个 agent tab，一次只显示当前 agent 的输入框；模型供应商页 agent-switch 改为实际 logo 渲染。

## 设计细节

### 1. 通用设置（GeneralTab.vue）路径区

- 4 个 tab 按钮（claude / codex / opencode / omp），内容为「agent logo + 名称」。
- logo 来源 `src/renderer/src/agentLogos.ts` 的 `AGENT_LOGOS`（与会话列表同一套官方品牌图，claude/codex 单色 currentColor、opencode/omp 自带品牌底色），渲染方式与 `AgentBadge.vue` 一致（`viewBox` + `v-html` inner）。
- 激活 tab 用各 agent 标识色背景（`--agent-*-bg`）+ 前景色（`--agent-*-fg`），非激活为输入框底色 + 边框。
- 下方单一输入框，`v-model` 动态绑定 `cfg.<agent>_path`（computed getter/setter 按 `selectedAgent` 取字段），`@change="markDirty"`。
- 默认选中 `claude`，切换 agent 后各路径值独立保存。

### 2. 模型供应商页（ProviderTab.vue）agent-switch

- 4 个切换按钮由 `agentMeta(k).abbr` 字母改为 `AgentBadge :agent="k" size="sm"`（16px logo，与会话列表一致）。
- 激活 tab 同样用 agent 标识色背景。

## 改动范围

- `src/renderer/src/components/settings/GeneralTab.vue`
- `src/renderer/src/components/settings/ProviderTab.vue`
- 复用已有 `agentLogos.ts` / `AgentBadge.vue`，无新增资源；`Icon.vue` 未改动。

## 验证

- `cd src/renderer && npx vue-tsc --noEmit` 通过。
- 前端开发模式检查：通用设置默认选中 Claude，切换 tab 显示对应 agent 路径输入；模型供应商页 4 个 logo 按钮切换正常；保存后各 agent 路径独立生效。
