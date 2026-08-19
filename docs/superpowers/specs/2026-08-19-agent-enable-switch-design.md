# Agent 启用开关设计

日期：2026-08-19

## 背景

当前 codex / opencode / omp 三个非 Claude agent 默认全部可用，前端 `AgentSelect`、通用设置路径 tab、模型供应商切换、会话列表均无条件渲染。需求：在设置页为每个非 Claude agent 提供独立开关（默认关闭），关闭后该 agent「不可用」——不能新建、历史会话隐藏、相关配置入口隐藏。

## 方案

- 设置字段新增 `codex_enabled` / `opencode_enabled` / `omp_enabled` 三个布尔（默认 `false`），复用现有 electron-store 整对象 `app:updateSettings` 链路，无新增 IPC。
- 主进程 `createSessionInternal` 入口校验（拒绝语义）：非 claude 且对应开关关闭时直接抛错，覆盖 IPC 与 WeCom 两条创建路径。
- 前端以 settings store 为唯一来源推导「可用 agent 列表」，四个消费点（AgentSelect / GeneralTab / ProviderTab / SessionList）统一消费。
- App 启动时全局加载一次 settings，保证首屏过滤正确。

## 设计细节

### 1. 设置字段与持久化

`src/renderer/src/types/settings.ts` `Settings` 接口新增：

```ts
codex_enabled: boolean
opencode_enabled: boolean
omp_enabled: boolean
```

`src/renderer/src/stores/settings.ts` `defaultSettings()` 对应默认值均 `false`。

electron-store 自由键值，`app:updateSettings`（`app.ts:1481`）整对象 `set(cfg)`，无需改主进程存储逻辑；老配置缺字段由 `{ ...defaultSettings(), ...raw }` 兜底为 `false`（符合默认关闭）。

### 2. 主进程校验（拒绝语义）

纯函数抽到 `src/main/agents/registry.ts`（或独立小模块），便于单测：

```ts
export function isAgentEnabledBySettings(settings: { get(k: string, d?: unknown): unknown }, kind: AgentKind): boolean {
  if (kind === 'claude') return true;
  return !!settings.get(`${kind}_enabled`, false);
}
```

`app.ts` 新增私有包装 `isAgentEnabled(kind)` 内部调用上函数（传入 `this.settingsStore`）。在 `createSessionInternal`（`app.ts:1165`）开头 `const spec = agentSpec(agent)` 之后加：

```ts
if (!isAgentEnabledBySettings(this.settingsStore, spec.kind)) {
  throw new Error(`${spec.label} 已在设置中禁用，请在通用设置中开启后重试`);
}
```

`createSessionInternal` 是唯一创建入口（IPC `app.ts:1435`、WeCom `app.ts:483` 都经过），一处校验全覆盖。抛错后被现有 handler catch → `notifyExternal` + reject，前端收到明确错误。

### 3. 前端可用 agent 推导（单一来源）

`src/renderer/src/stores/settings.ts` 新增：

```ts
import type { AgentKind } from '../types/agents'

const enabledAgentKinds = computed<AgentKind[]>(() => {
  const out: AgentKind[] = ['claude']
  const c = cfg.value
  if (!c) return out // cfg 未加载时按默认关闭处理，仅 claude
  if (c.codex_enabled) out.push('codex')
  if (c.opencode_enabled) out.push('opencode')
  if (c.omp_enabled) out.push('omp')
  return out
})

function isAgentEnabled(kind: AgentKind): boolean {
  if (kind === 'claude') return true
  const c = cfg.value
  if (!c) return false
  return !!c[`${kind}_enabled` as 'codex_enabled' | 'opencode_enabled' | 'omp_enabled']
}
```

store 返回中导出两者。四个消费点统一消费，不各自复制过滤逻辑。

### 4. 消费点接入

**AgentSelect.vue**：`options` computed 由 `AGENT_KINDS.map(...)` 改为 `settings.enabledAgentKinds.map(...)`；`watch(settings.enabledAgentKinds)`，当前 `modelValue` 不在可用列表时 `emit('update:modelValue', 'claude')`，避免「选中 codex 后被关闭」导致下拉悬空。

**GeneralTab.vue**：
- 路径 tab `v-for="k in AGENT_KINDS"` 改为 `settings.enabledAgentKinds`。
- 新增「Agent 启用」form-group，复用现有 `.switch-list` / `.switch-row` / `Switch.vue` 样式，三行：Codex / OpenCode / OMP，`v-model` 绑 `cfg.codex_enabled` / `cfg.opencode_enabled` / `cfg.omp_enabled`，`@change="markDirty"`。claude 不设开关（始终可用）。
- `watch(settings.enabledAgentKinds)`：`selectedAgent` 不在可用列表时重置为 `'claude'`。

**ProviderTab.vue**：agent-switch 的 `v-for="k in AGENT_KINDS"` 改为 `settings.enabledAgentKinds`，同样的选中重置 watch；`selectedAgent` 重置后 providers 卡片区随之显示 claude 的供应商。

**SessionList.vue**：`filteredList` computed 在搜索过滤前先做 agent 过滤：

```ts
const settings = useSettingsStore()
const filteredList = computed(() => {
  let arr = props.list.filter((s) => settings.isAgentEnabled(agentMeta(s.agent).kind))
  // ... 原有搜索过滤
})
```

`agentMeta(s.agent)` 对缺失/未知 agent 回退 claude → 恒显示，向后兼容老会话。

### 5. 全局设置加载

`src/renderer/src/App.vue` `onMounted` 增加 `settings.load()`，保证启动即拿到 cfg，四个消费点首屏过滤正确。`load()` 内部已有 `setThemeMode`，与现状一致，无副作用。

### 6. 错误处理与测试

- 主进程：`tests/main/` 给 `isAgentEnabledBySettings` 加单测——claude 恒真、缺字段默认 false、显式 true 时生效。
- 前端：settings store 的 `enabledAgentKinds` / `isAgentEnabled` 加 vitest（参照已有 `BuddyTab.test.ts` 的 settings store 用法）：默认仅 claude；开启后逐个出现；cfg 未加载返回仅 claude。
- 完成标准：`npm run test:main` 与 `cd src/renderer && npx vue-tsc --noEmit` 全绿。

## 边界情况

- 已有 codex 会话被隐藏后，云服务端仍可见（不影响云端）。
- 关闭开关不影响正在运行的会话进程，仅影响「新建」与「前端可见性」。
- ProviderTab 当前选中 agent 被禁用时，`selectedAgent` 重置为 claude，供应商卡片区切换显示 claude 的供应商。

## 改动范围

- `src/renderer/src/types/settings.ts`
- `src/renderer/src/stores/settings.ts`
- `src/renderer/src/App.vue`
- `src/renderer/src/components/AgentSelect.vue`
- `src/renderer/src/components/settings/GeneralTab.vue`
- `src/renderer/src/components/settings/ProviderTab.vue`
- `src/renderer/src/components/SessionList.vue`
- `src/main/agents/registry.ts`（新增 `isAgentEnabledBySettings` 纯函数）
- `src/main/app.ts`（`createSessionInternal` 校验）
- `tests/main/`（新增 agent 启用校验单测）
- `src/renderer/src/stores/settings.test.ts`（新增，如不存在则建）

## 验证

- `npm run test:main` 全绿。
- `cd src/renderer && npx vue-tsc --noEmit` 通过。
- 前端开发模式手测：默认三个开关关闭 → 新建会话下拉仅 Claude、通用设置路径仅 Claude tab、模型供应商仅 Claude 切换、会话列表不显示 codex/opencode/omp 老会话；开启某 agent 后上述各处恢复显示；直接 IPC 创建被禁用的 agent 会话返回明确错误。
