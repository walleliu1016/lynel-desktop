# Agent 启用开关实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在通用设置页为 codex / opencode / omp 各加一个启用开关（默认关闭）；关闭的 agent 在主进程拒绝创建会话，在前端新建下拉、路径配置、供应商切换、会话列表四处隐藏。

**Architecture:** 三个布尔设置字段走现有 electron-store `app:updateSettings` 整对象链路。主进程在唯一创建入口 `createSessionInternal` 校验（拒绝语义）。前端以 settings store 的 `enabledAgentKinds` / `isAgentEnabled` 为单一来源，四个消费点统一过滤；App 启动时全局加载一次设置。

**Tech Stack:** Electron 主进程（TS、vitest 测 `tests/main/`）、Vue 3 + Pinia setup store + vue-tsc 类型检查、vitest + @vue/test-utils（`src/renderer/`）。

## Global Constraints

- 代码注释、commit message 用简体中文；commit 格式 `<type>: <subject>`，一个 task 一个 commit。
- 每次 commit 前必须跑绿：`npm run test:main` 与 `cd src/renderer && npx vue-tsc --noEmit`。
- 主进程测试 import 用 `.js` 后缀（如 `from '../../src/main/agents/registry.js'`，vitest 解析到 TS）。
- claude 恒可用，不设开关；三个新开关默认 `false`。
- 前端不可用 agent 的推导以 settings store 为唯一来源，不在组件里复制过滤逻辑。
- 主进程校验为拒绝语义（抛错），不回退 claude。

---

### Task 1: 主进程 `isAgentEnabledBySettings` 纯函数 + 单测

**Files:**
- Modify: `src/main/agents/registry.ts`（文件末尾追加函数）
- Create: `tests/main/agents/registry.test.ts`

**Interfaces:**
- Produces: `isAgentEnabledBySettings(settings: { get(key: string, defaultValue?: unknown): unknown }, kind: AgentKind): boolean` —— claude 恒 `true`；codex/opencode/omp 读 `settings.get('<kind>_enabled', false)`。经 `agents/index.ts` barrel 自动 re-export。

- [ ] **Step 1: 写失败测试**

创建 `tests/main/agents/registry.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { isAgentEnabledBySettings, agentSpec } from '../../src/main/agents/registry.js';
import type { AgentKind } from '../../src/main/agents/types.js';

function fakeSettings(overrides: Record<string, unknown> = {}) {
  return { get: (key: string, d?: unknown) => (key in overrides ? overrides[key] : d) };
}

describe('isAgentEnabledBySettings', () => {
  it('claude 恒启用（不读开关）', () => {
    expect(isAgentEnabledBySettings(fakeSettings(), 'claude')).toBe(true);
  });
  it('缺省开关默认关闭', () => {
    for (const k of ['codex', 'opencode', 'omp'] as AgentKind[]) {
      expect(isAgentEnabledBySettings(fakeSettings(), k)).toBe(false);
    }
  });
  it('显式开启后启用', () => {
    expect(isAgentEnabledBySettings(fakeSettings({ codex_enabled: true }), 'codex')).toBe(true);
    expect(isAgentEnabledBySettings(fakeSettings({ codex_enabled: false }), 'codex')).toBe(false);
  });
  it('agentSpec 未知回退 claude', () => {
    expect(agentSpec('unknown' as AgentKind).kind).toBe('claude');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/main/agents/registry.test.ts`
Expected: FAIL，`isAgentEnabledBySettings is not defined`。

- [ ] **Step 3: 最小实现**

在 `src/main/agents/registry.ts` 文件末尾（`agentSpec` 之后）追加：

```ts
/** 按 settings 判断某 agent 是否启用：claude 恒启用，codex/opencode/omp 读 `<kind>_enabled` 开关（缺省关闭） */
export function isAgentEnabledBySettings(settings: { get(key: string, defaultValue?: unknown): unknown }, kind: AgentKind): boolean {
  if (kind === 'claude') return true;
  return !!settings.get(`${kind}_enabled`, false);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/main/agents/registry.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/main/agents/registry.ts tests/main/agents/registry.test.ts
git commit -m "$(cat <<'EOF'
feat: 新增 isAgentEnabledBySettings 纯函数
EOF
)"
```

---

### Task 2: 主进程 `createSessionInternal` 拦截禁用 agent

**Files:**
- Modify: `src/main/app.ts:15`（import 行）、`src/main/app.ts:1167`（`const spec = agentSpec(agent);` 之后）

**Interfaces:**
- Consumes: `isAgentEnabledBySettings`（Task 1 产出，经 `./agents/index.js` 导出）、`this.settingsStore`（electron-store，有 `.get(key, default)`）。

- [ ] **Step 1: 引入并接入校验**

`src/main/app.ts` 第 15 行 import 追加：

```ts
import { agentSpec, isAgentEnabledBySettings, type AgentKind, type AgentSpec } from './agents/index.js';
```

在 `createSessionInternal`（第 1167 行）`const spec = agentSpec(agent);` 之后插入：

```ts
if (!isAgentEnabledBySettings(this.settingsStore, spec.kind)) {
  throw new Error(`${spec.label} 已在设置中禁用，请在通用设置中开启后重试`);
}
```

`createSessionInternal` 是唯一创建入口（IPC `app.ts:1435`、WeCom `app.ts:483` 均经过），此处拦截覆盖所有路径；异常被 `app:createSession` handler catch → `notifyExternal` + reject。

- [ ] **Step 2: 主进程类型检查**

Run: `npm run build:electron`
Expected: 编译通过，无 TS 错误。

- [ ] **Step 3: 回归 + 提交**

Run: `npm run test:main` && `cd src/renderer && npx vue-tsc --noEmit`
Expected: 全绿。

```bash
git add src/main/app.ts
git commit -m "$(cat <<'EOF'
feat: 主进程拦截禁用 agent 的会话创建
EOF
)"
```

---

### Task 3: 前端设置字段 + settings store 可用 agent 推导 + 单测

**Files:**
- Modify: `src/renderer/src/types/settings.ts`（`Settings` 接口）
- Modify: `src/renderer/src/stores/settings.ts`
- Create: `src/renderer/src/stores/settings.test.ts`

**Interfaces:**
- Produces: `useSettingsStore()` 新增导出：
  - `enabledAgentKinds: ComputedRef<AgentKind[]>` —— claude 恒在 + 开关开启者；cfg 未加载时仅 `['claude']`。
  - `isAgentEnabled(kind: AgentKind): boolean` —— claude 恒 `true`；cfg 未加载时 `false`。

- [ ] **Step 1: 写失败测试**

创建 `src/renderer/src/stores/settings.test.ts`：

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from './settings'
import { GetSettings } from '../composables/useElectron'

vi.mock('../composables/useElectron', () => ({
  GetSettings: vi.fn(),
  UpdateSettings: vi.fn().mockResolvedValue(undefined),
}))

describe('settings store 可用 agent 推导', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('cfg 未加载时仅 claude', () => {
    const store = useSettingsStore()
    expect(store.enabledAgentKinds).toEqual(['claude'])
    expect(store.isAgentEnabled('claude')).toBe(true)
    expect(store.isAgentEnabled('codex')).toBe(false)
  })

  it('默认设置（全关）仅 claude', async () => {
    vi.mocked(GetSettings).mockResolvedValue(null)
    const store = useSettingsStore()
    await store.load()
    expect(store.enabledAgentKinds).toEqual(['claude'])
  })

  it('开启后逐个加入可用列表', async () => {
    vi.mocked(GetSettings).mockResolvedValue(null)
    const store = useSettingsStore()
    await store.load()
    store.cfg!.codex_enabled = true
    expect(store.enabledAgentKinds).toEqual(['claude', 'codex'])
    expect(store.isAgentEnabled('opencode')).toBe(false)
    store.cfg!.opencode_enabled = true
    store.cfg!.omp_enabled = true
    expect(store.enabledAgentKinds).toEqual(['claude', 'codex', 'opencode', 'omp'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd src/renderer && npx vitest run stores/settings.test.ts`
Expected: FAIL，`store.enabledAgentKinds` 为 undefined。

- [ ] **Step 3: 实现字段与推导**

`src/renderer/src/types/settings.ts` `Settings` 接口（在 `omp_path` 之后）新增：

```ts
  codex_enabled: boolean
  opencode_enabled: boolean
  omp_enabled: boolean
```

`src/renderer/src/stores/settings.ts`：
- import 改 `import { ref, computed, watch } from 'vue'`，追加 `import type { AgentKind } from '../types/agents'`。
- `defaultSettings()` 追加 `codex_enabled: false, opencode_enabled: false, omp_enabled: false`。
- store 体内（`markDirty` 之后）新增：

```ts
  const enabledAgentKinds = computed<AgentKind[]>(() => {
    const out: AgentKind[] = ['claude']
    const c = cfg.value
    if (!c) return out
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

- return 语句改为 `return { cfg, dirty, load, save, markDirty, enabledAgentKinds, isAgentEnabled }`。

- [ ] **Step 4: 运行确认通过**

Run: `cd src/renderer && npx vitest run stores/settings.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 类型检查 + 提交**

Run: `npm run test:main` && `cd src/renderer && npx vue-tsc --noEmit`
Expected: 全绿。

```bash
git add src/renderer/src/types/settings.ts src/renderer/src/stores/settings.ts src/renderer/src/stores/settings.test.ts
git commit -m "$(cat <<'EOF'
feat: 设置新增 agent 启用开关字段与可用列表推导
EOF
)"
```

---

### Task 4: App 全局加载设置 + AgentSelect 过滤与回退

**Files:**
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/components/AgentSelect.vue`
- Create: `src/renderer/src/components/AgentSelect.test.ts`

**Interfaces:**
- Consumes: `settings.enabledAgentKinds`、`settings.isAgentEnabled`（Task 3 产出）、`settings.load()`。

- [ ] **Step 1: 写失败测试**

创建 `src/renderer/src/components/AgentSelect.test.ts`：

```ts
// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import AgentSelect from './AgentSelect.vue'
import { useSettingsStore } from '../stores/settings'
import { GetSettings } from '../composables/useElectron'

vi.mock('../composables/useElectron', () => ({
  GetSettings: vi.fn(),
  UpdateSettings: vi.fn().mockResolvedValue(undefined),
}))

const SelectStub = {
  props: ['modelValue', 'options', 'placeholder'],
  emits: ['update:modelValue'],
  template: `<div class="sel-stub" :data-count="options.length">{{ modelValue }}</div>`,
}

describe('AgentSelect 可用 agent 过滤', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('默认仅展示 claude', async () => {
    vi.mocked(GetSettings).mockResolvedValue(null)
    const store = useSettingsStore()
    await store.load()
    const w = mount(AgentSelect, { props: { modelValue: 'claude' }, global: { stubs: { Select: SelectStub } } })
    expect(w.find('.sel-stub').attributes('data-count')).toBe('1')
  })

  it('选中 agent 被禁用后回退 claude', async () => {
    vi.mocked(GetSettings).mockResolvedValue({ codex_enabled: true } as any)
    const store = useSettingsStore()
    await store.load()
    const w = mount(AgentSelect, { props: { modelValue: 'codex' }, global: { stubs: { Select: SelectStub } } })
    expect(w.find('.sel-stub').attributes('data-count')).toBe('2')
    store.cfg!.codex_enabled = false
    await w.vm.$nextTick()
    expect(w.emitted('update:modelValue')).toBeTruthy()
    expect(w.emitted('update:modelValue')![0]).toEqual(['claude'])
    expect(w.find('.sel-stub').attributes('data-count')).toBe('1')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd src/renderer && npx vitest run components/AgentSelect.test.ts`
Expected: FAIL（options 仍包含全部 4 个，count 断言不符）。

- [ ] **Step 3: 实现**

`src/renderer/src/App.vue`：`onMounted` 内（现有 applyLoginLayout 之前）加全局设置加载：

```ts
import { useSettingsStore } from './stores/settings'
...
const settings = useSettingsStore()
...
try { await settings.load() } catch {}
```

`src/renderer/src/components/AgentSelect.vue`：
- import 改：`import { computed, watch } from 'vue'`、`import { agentMeta, type AgentKind } from '../types/agents'`、追加 `import { useSettingsStore } from '../stores/settings'`；删除 `AGENT_KINDS` 导入。
- script 新增 `const settings = useSettingsStore()`。
- `options` 的 map 源改为 `settings.enabledAgentKinds`：

```ts
const options = computed<SelectOption[]>(() =>
  settings.enabledAgentKinds.map((k) => {
    const m = agentMeta(k)
    const logo = AGENT_LOGOS[k]
    return {
      value: k,
      label: m.label,
      icon: {
        bg: 'transparent',
        fg: `var(${m.fgVar})`,
        svg: logo.inner,
        viewBox: logo.viewBox,
      },
    }
  }),
)

watch(settings.enabledAgentKinds, (kinds) => {
  if (!kinds.includes(props.modelValue)) emit('update:modelValue', 'claude')
})
```

- [ ] **Step 4: 运行确认通过**

Run: `cd src/renderer && npx vitest run components/AgentSelect.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 类型检查 + 提交**

Run: `npm run test:main` && `cd src/renderer && npx vue-tsc --noEmit`
Expected: 全绿。

```bash
git add src/renderer/src/App.vue src/renderer/src/components/AgentSelect.vue src/renderer/src/components/AgentSelect.test.ts
git commit -m "$(cat <<'EOF'
feat: 新建会话 agent 下拉按开关过滤并回退 claude
EOF
)"
```

---

### Task 5: GeneralTab 新增启用开关并过滤路径 tab

**Files:**
- Modify: `src/renderer/src/components/settings/GeneralTab.vue`

**Interfaces:**
- Consumes: `settings.enabledAgentKinds`、`cfg.codex_enabled/opencode_enabled/omp_enabled`（Task 3 产出）。

- [ ] **Step 1: 实现**

`GeneralTab.vue`：
- 路径 tab 的 `v-for="k in AGENT_KINDS"` 改为 `v-for="k in settings.enabledAgentKinds"`（模板里 `AGENT_KINDS` 不再使用）。
- 「Agent 可执行文件路径」form-group 之前新增「Agent 启用」开关组（复用 `.switch-list`/`.switch-row`/`Switch.vue`）：

```html
    <div class="form-group">
      <label class="form-label">Agent 启用</label>
      <div class="switch-list">
        <label class="switch-row">
          <span class="switch-label">启用 Codex</span>
          <Switch v-model="cfg.codex_enabled" @change="markDirty" />
        </label>
        <label class="switch-row">
          <span class="switch-label">启用 OpenCode</span>
          <Switch v-model="cfg.opencode_enabled" @change="markDirty" />
        </label>
        <label class="switch-row">
          <span class="switch-label">启用 OMP</span>
          <Switch v-model="cfg.omp_enabled" @change="markDirty" />
        </label>
      </div>
    </div>
```

- script：
  - import 改 `import { onMounted, computed, ref, watch } from 'vue'`；删除 `AGENT_KINDS` 导入（保留 `agentMeta`、`type AgentKind`）。
  - `cfg` 兜底字面量追加 `codex_enabled: false, opencode_enabled: false, omp_enabled: false`（防止 load 前 cfg 兜底缺字段）。
  - `markDirty` 之后新增选中回退：

```ts
watch(settings.enabledAgentKinds, (kinds) => {
  if (!kinds.includes(selectedAgent.value)) selectedAgent.value = 'claude'
})
```

- [ ] **Step 2: 类型检查 + 提交**

Run: `npm run test:main` && `cd src/renderer && npx vue-tsc --noEmit`
Expected: 全绿。

```bash
git add src/renderer/src/components/settings/GeneralTab.vue
git commit -m "$(cat <<'EOF'
feat: 通用设置新增 agent 启用开关并过滤路径 tab
EOF
)"
```

---

### Task 6: ProviderTab agent 切换按开关过滤

**Files:**
- Modify: `src/renderer/src/components/settings/ProviderTab.vue`

**Interfaces:**
- Consumes: `settings.enabledAgentKinds`（Task 3 产出）。

- [ ] **Step 1: 实现**

`ProviderTab.vue`：
- agent-switch 的 `v-for="k in AGENT_KINDS"` 改为 `v-for="k in settings.enabledAgentKinds"`。
- script：
  - import 改 `import { onMounted, ref, computed, watch } from 'vue'`；`import { AGENT_KINDS, agentMeta } from '../../types/agents'` 改为 `import { agentMeta, type AgentKind } from '../../types/agents'`。
  - `const selectedAgent = ref('claude')` 改为 `const selectedAgent = ref<AgentKind>('claude')`。
  - 追加 `const settings = useSettingsStore()`（从 `../../stores/settings` 导入）。
  - `markDirty` 之外（script 末尾）新增选中回退：

```ts
watch(settings.enabledAgentKinds, (kinds) => {
  if (!kinds.includes(selectedAgent.value)) selectedAgent.value = 'claude'
})
```

- [ ] **Step 2: 类型检查 + 提交**

Run: `npm run test:main` && `cd src/renderer && npx vue-tsc --noEmit`
Expected: 全绿。

```bash
git add src/renderer/src/components/settings/ProviderTab.vue
git commit -m "$(cat <<'EOF'
feat: 模型供应商 agent 切换按开关过滤
EOF
)"
```

---

### Task 7: SessionList 隐藏禁用 agent 的历史会话

**Files:**
- Modify: `src/renderer/src/components/SessionList.vue`

**Interfaces:**
- Consumes: `settings.isAgentEnabled`、`agentMeta(s.agent).kind`（未知/缺失回退 claude → 恒显示）。

- [ ] **Step 1: 实现**

`SessionList.vue`：
- import 追加 `import { agentMeta } from '../types/agents'`、`import { useSettingsStore } from '../stores/settings'`。
- script 新增 `const settings = useSettingsStore()`。
- `filteredList` computed 改为先按 agent 过滤再搜索：

```ts
const filteredList = computed(() => {
  const arr = props.list.filter((s) => settings.isAgentEnabled(agentMeta(s.agent).kind))
  const q = (props.search || '').trim().toLowerCase()
  if (!q) return arr
  return arr.filter((s) => {
    const pn = s.project.toLowerCase()
    const wd = s.workdir.toLowerCase()
    const title = (s.user_title || s.first_prompt || s.ai_title || '').toLowerCase()
    const sid = s.id.toLowerCase()
    return pn.includes(q) || wd.includes(q) || title.includes(q) || sid.includes(q)
  })
})
```

- [ ] **Step 2: 类型检查 + 提交**

Run: `npm run test:main` && `cd src/renderer && npx vue-tsc --noEmit`
Expected: 全绿。

```bash
git add src/renderer/src/components/SessionList.vue
git commit -m "$(cat <<'EOF'
feat: 会话列表隐藏禁用 agent 的历史会话
EOF
)"
```

---

## 手工验证清单（全部任务完成后）

- `npm run dev` 全栈启动。
- 通用设置默认三个开关关闭：新建会话下拉仅 Claude、路径 tab 仅 Claude、模型供应商仅 Claude 切换、会话列表无 codex/opencode/omp 老会话。
- 开启 Codex → 上述四处恢复 Codex；关闭后选中 Codex 的下拉自动回退 Claude。
- 直接 IPC 创建禁用 agent（`CreateSession(workDir, '', [], 'codex')`）返回「已在设置中禁用」错误，会话未创建。
- 会话列表搜索与 agent 过滤同时生效。
