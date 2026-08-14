# 多 Agent 前端 UI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前端支持 claude/codex/opencode/omp 四种 agent：新建会话可选、4 区域类型标识、每 agent 路径配置、ProviderTab 按 agent 分组。

**Architecture:** 前端定义 `AGENT_META`（label/abbr/配色 CSS 变量）作为唯一显示真相源，复用 `AgentBadge.vue` 组件在 4 区域显示类型；`agent` 字段经主进程 recent-sessions.json 持久化并透传到 `SessionMeta`/`RecentSession`；ProviderTab 改为 agent 分组框架（claude 完整迁移、非 claude 预留）。后端 `src/main/agents/` 的 `AgentSpec` 已在前序任务落地（不回归）。

**Tech Stack:** Vue 3 + Pinia + TypeScript + vitest（renderer）；Electron 主进程 tsc + vitest（tests/main）。

**关联设计文档：** `docs/superpowers/specs/2026-08-09-multi-agent-ui-design.md`、`docs/superpowers/specs/2026-08-09-multi-agent-support-design.md`

---

## 文件结构

**新增：**
- `src/renderer/src/types/agents.ts` — AgentKind/AgentMeta/AGENT_META/agentMeta()
- `src/renderer/src/components/AgentBadge.vue` — 缩写徽标，4 区域复用
- `src/renderer/src/components/AgentSelect.vue` — 新建会话下拉
- `src/renderer/vitest.config.ts` — renderer 测试配置
- `tests/main/session-agent.test.ts` — 主进程 agent 数据模型测试

**修改：**
- `src/renderer/src/styles/theme.css` — agent 配色变量
- `src/main/app.ts` — RecentSessionRecord.agent、createSessionInternal 写 agent、mergeRecentTitles 带 agent、claudeBin 按 agent 读路径
- `src/renderer/src/types/session.ts` — SessionMeta.agent
- `src/renderer/src/types/recent.ts` — RecentSession.agent
- `src/renderer/src/types/settings.ts` — Settings 加 agent 路径字段
- `src/renderer/src/types/providers.ts` — Provider.agent
- `src/renderer/src/stores/sessions.ts` — recentToMeta/create/applyRebind 透传 agent
- `src/renderer/src/stores/settings.ts` — defaultSettings 加 agent 路径
- `src/renderer/src/stores/sessions.test.ts` — agent 相关单测
- `src/renderer/src/components/NewSessionDialog.vue` — AgentSelect + 联动
- `src/renderer/src/components/SessionItem.vue` — avatar 换 AgentBadge
- `src/renderer/src/components/SessionTabContent.vue` — loading 文案
- `src/renderer/src/components/GlobalTabs.vue` — tab 标签 AgentBadge
- `src/renderer/src/components/RecentSessionList.vue` — 项前置 AgentBadge
- `src/renderer/src/components/SessionTooltip.vue` — AgentBadge + label
- `src/renderer/src/components/settings/GeneralTab.vue` — 每 agent 路径
- `src/renderer/src/components/settings/ProviderTab.vue` — agent 分组
- `src/renderer/src/stores/providers.ts` — provider.agent
- `src/renderer/src/views/HomeView.vue` — onCreateFromSession 传 agent
- `src/renderer/package.json` — test 脚本

---

### Task 1: 前端 agent 元数据（AGENT_META + 配色）

**Files:**
- Create: `src/renderer/src/types/agents.ts`
- Modify: `src/renderer/src/styles/theme.css`

- [ ] **Step 1: 创建 types/agents.ts**

```ts
// AgentKind：与主进程 src/main/agents/types.ts 对齐
export type AgentKind = 'claude' | 'codex' | 'opencode' | 'omp'

export interface AgentMeta {
  kind: AgentKind
  label: string     // 完整名（tooltip/loading 用）
  short: string     // 下拉显示名
  abbr: string      // badge 缩写
  bgVar: string     // theme.css CSS 变量名
  fgVar: string
  tagline: string
}

export const AGENT_KINDS: AgentKind[] = ['claude', 'codex', 'opencode', 'omp']

export const AGENT_META: Record<AgentKind, AgentMeta> = {
  claude:   { kind: 'claude', label: 'Claude Code', short: 'Claude', abbr: 'CC', bgVar: '--agent-claude-bg', fgVar: '--agent-claude-fg', tagline: 'Anthropic 官方 CLI' },
  codex:    { kind: 'codex', label: 'Codex', short: 'Codex', abbr: 'CX', bgVar: '--agent-codex-bg', fgVar: '--agent-codex-fg', tagline: 'OpenAI CLI' },
  opencode: { kind: 'opencode', label: 'OpenCode', short: 'OpenCode', abbr: 'OC', bgVar: '--agent-opencode-bg', fgVar: '--agent-opencode-fg', tagline: 'SST 开源' },
  omp:      { kind: 'omp', label: 'OMP', short: 'OMP', abbr: 'PI', bgVar: '--agent-omp-bg', fgVar: '--agent-omp-fg', tagline: 'oh-my-pi' },
}

/** 未知/缺省 agent 一律回退 claude（老会话向后兼容） */
export function agentMeta(agent?: string | null): AgentMeta {
  if (agent && AGENT_META[agent as AgentKind]) return AGENT_META[agent as AgentKind]
  return AGENT_META.claude
}
```

- [ ] **Step 2: theme.css 追加 agent 配色变量**

在 `src/renderer/src/styles/theme.css` 的 `:root`（浅色主题）块内追加：

```css
  /* agent 类型标识配色 */
  --agent-claude-bg: #fde68a;
  --agent-claude-fg: #92400e;
  --agent-codex-bg: #dcfce7;
  --agent-codex-fg: #166534;
  --agent-opencode-bg: #dbeafe;
  --agent-opencode-fg: #1e40af;
  --agent-omp-bg: #ede9fe;
  --agent-omp-fg: #5b21b6;
```

- [ ] **Step 3: 验证类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS（无 agents.ts 相关错误）

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/types/agents.ts src/renderer/src/styles/theme.css
git commit -m "feat: 前端 agent 元数据 AGENT_META 与配色变量"
```

---

### Task 2: AgentBadge / AgentSelect 组件 + renderer vitest 配置

**Files:**
- Create: `src/renderer/src/components/AgentBadge.vue`
- Create: `src/renderer/src/components/AgentSelect.vue`
- Create: `src/renderer/vitest.config.ts`
- Modify: `src/renderer/package.json`（test 脚本）

- [ ] **Step 1: 配置 renderer vitest**

确认 `@vitejs/plugin-vue` 在 `src/renderer/package.json` devDependencies 中（`npm ls @vitejs/plugin-vue` 验证；缺失则 `npm i -D @vitejs/plugin-vue`）。

创建 `src/renderer/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: { environment: 'jsdom' },
})
```

修改 `src/renderer/package.json` scripts：

```json
"test": "vitest run",
```

- [ ] **Step 2: 创建 AgentBadge.vue**

`src/renderer/src/components/AgentBadge.vue`：

```vue
<template>
  <span class="agent-badge" :class="size" :style="badgeStyle" :title="meta.label">{{ meta.abbr }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { agentMeta } from '../types/agents'

const props = withDefaults(defineProps<{ agent?: string | null; size?: 'sm' | 'md' }>(), { size: 'md' })
const meta = computed(() => agentMeta(props.agent))
const badgeStyle = computed(() => ({ background: `var(${meta.value.bgVar})`, color: `var(${meta.value.fgVar})` }))
</script>

<style scoped>
.agent-badge { display: inline-flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; user-select: none; }
.agent-badge.md { width: 34px; height: 34px; border-radius: 10px; font-size: 11px; }
.agent-badge.sm { width: 20px; height: 20px; border-radius: 6px; font-size: 9px; }
</style>
```

- [ ] **Step 3: 创建 AgentSelect.vue**

`src/renderer/src/components/AgentSelect.vue`：

```vue
<template>
  <select class="agent-select" :value="modelValue" @change="onChange">
    <option v-for="k in AGENT_KINDS" :key="k" :value="k">{{ meta(k).abbr }} {{ meta(k).short }}</option>
  </select>
</template>

<script setup lang="ts">
import { AGENT_KINDS, agentMeta, type AgentKind } from '../types/agents'

defineProps<{ modelValue: AgentKind }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: AgentKind): void }>()

function onChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLSelectElement).value as AgentKind)
}
</script>

<style scoped>
.agent-select {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 8px 10px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
}
.agent-select:focus { outline: none; border-color: var(--accent); }
</style>
```

- [ ] **Step 4: 写组件单测（TDD）**

创建 `src/renderer/src/components/AgentBadge.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentBadge from './AgentBadge.vue'

describe('AgentBadge', () => {
  it('缺省 agent 回退 claude 显示 CC', () => {
    const w = mount(AgentBadge)
    expect(w.text()).toBe('CC')
  })
  it('codex 显示 CX', () => {
    const w = mount(AgentBadge, { props: { agent: 'codex' } })
    expect(w.text()).toBe('CX')
  })
  it('未知 agent 回退 claude', () => {
    const w = mount(AgentBadge, { props: { agent: 'unknown-agent' } })
    expect(w.text()).toBe('CC')
  })
  it('sm 尺寸应用 sm class', () => {
    const w = mount(AgentBadge, { props: { size: 'sm' } })
    expect(w.classes()).toContain('sm')
  })
})
```

- [ ] **Step 5: 运行组件测试**

Run: `cd src/renderer && npm test`
Expected: PASS（AgentBadge 4 个用例）

- [ ] **Step 6: Commit**

```bash
git add src/renderer/vitest.config.ts src/renderer/package.json src/renderer/src/components/AgentBadge.vue src/renderer/src/components/AgentSelect.vue src/renderer/src/components/AgentBadge.test.ts
git commit -m "feat: AgentBadge/AgentSelect 组件与 renderer vitest 配置"
```

---

### Task 3: 主进程 agent 数据模型

**Files:**
- Modify: `src/main/app.ts`（RecentSessionRecord、createSessionInternal、mergeRecentTitles）
- Create: `tests/main/session-agent.test.ts`

- [ ] **Step 1: RecentSessionRecord 加 agent 字段**

`src/main/app.ts` 的 `interface RecentSessionRecord`（约 182 行）加字段：

```ts
interface RecentSessionRecord {
  sessionId: string;
  workdir: string;
  project: string;
  aiTitle: string;
  firstPrompt: string;
  userTitle?: string;
  lastOpenedAt: number;
  state: string;
  botId?: string;
  agent?: string;   // 新增：agent 类型，缺省 claude
  /** 用户在 claude 终端里主动执行了 /exit ... */
  terminated?: boolean;
}
```

- [ ] **Step 2: createSessionInternal 写 agent 到 recents**

`src/main/app.ts` 的 `createSessionInternal` 内 `addRecentSession({...})` 调用（约 1112 行）加 `agent`：

```ts
    addRecentSession({
      sessionId: realId,
      workdir: workDir,
      project,
      aiTitle: '',
      firstPrompt: prompt,
      lastOpenedAt: Date.now(),
      state: 'running',
      botId,
      agent: spec.kind,   // 新增：spec 来自 agentSpec(agent)
    }).catch((err) => getLogger().error(`[app] addRecentSession failed: ${err?.message ?? err}`));
```

- [ ] **Step 3: jsonl.ts SessionMeta 加 agent + 新增 mergeRecentAgentField 纯函数**

`src/main/jsonl.ts` 的 `SessionMeta` 接口加：

```ts
  agent?: string
```

`src/main/app.ts` 顶层新增导出纯函数（供测试）：

```ts
export function mergeRecentAgentField(raw: jsonl.SessionMeta[], recents: RecentSessionRecord[]): jsonl.SessionMeta[] {
  const map = new Map(recents.map((r) => [r.sessionId, r]));
  return raw.map((s) => {
    const r = map.get(s.id);
    if (!r) return s;
    const merged: jsonl.SessionMeta = { ...s };
    if (r.agent) merged.agent = r.agent;
    return merged;
  });
}
```

- [ ] **Step 3b: mergeRecentTitles 改为调用 mergeRecentAgentField**

`src/main/app.ts` 的 `mergeRecentTitles`（约 1189 行）改为先做 agent 合并，再保留原有 userTitle/aiTitle 合并：

```ts
  private mergeRecentTitles(raw: jsonl.SessionMeta[]): jsonl.SessionMeta[] {
    const recents = this.withRecentLock(() => readRecentSessions());
    const withAgent = mergeRecentAgentField(raw, recents);
    const map = new Map(recents.map((r) => [r.sessionId, r]));
    return withAgent.map((s) => {
      const r = map.get(s.id);
      if (!r) return s;
      if (r.userTitle) {
        return { ...s, user_title: r.userTitle, title_source: 'user' as jsonl.TitleSource };
      }
      if (r.aiTitle) {
        return { ...s, ai_title: r.aiTitle, title_source: 'ai' as jsonl.TitleSource };
      }
      return s;
    });
  }
```

- [ ] **Step 4: 写主进程单测**

`mergeRecentAgentField` 已在上一步定义并导出（`mergeRecentTitles` 已改为调用它）。创建 `tests/main/session-agent.test.ts` 直接测该纯函数：

```ts
import { describe, it, expect } from 'vitest';
import { mergeRecentAgentField } from '../src/main/app.js';
import type { SessionMeta as JsonlSessionMeta } from '../src/main/jsonl.js';

describe('mergeRecentAgentField', () => {
  it('recents 带 agent 时合并到 SessionMeta', () => {
    const raw = [{ id: 'sid-1', workdir: '/p', project: 'p', mtime: 1 }] as unknown as JsonlSessionMeta[];
    const recents = [{ sessionId: 'sid-1', workdir: '/p', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle', agent: 'codex' }];
    const out = mergeRecentAgentField(raw, recents);
    expect(out[0].agent).toBe('codex');
  });
  it('recents 无 agent 时不覆盖', () => {
    const raw = [{ id: 'sid-1', workdir: '/p', project: 'p', mtime: 1 }] as unknown as JsonlSessionMeta[];
    const recents = [{ sessionId: 'sid-1', workdir: '/p', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle' }];
    const out = mergeRecentAgentField(raw, recents);
    expect(out[0].agent).toBeUndefined();
  });
});
```

- [ ] **Step 5: 运行主进程测试**

Run: `npm run test:main`
Expected: 新增 2 个用例 PASS（`session-agent.test.ts`）

- [ ] **Step 6: Commit**

```bash
git add src/main/app.ts tests/main/session-agent.test.ts src/main/jsonl.ts
git commit -m "feat: 主进程 agent 数据模型（recents.agent + mergeRecent 带 agent）"
```

---

### Task 4: 前端数据模型透传

**Files:**
- Modify: `src/renderer/src/types/session.ts`、`src/renderer/src/types/recent.ts`
- Modify: `src/renderer/src/stores/sessions.ts`
- Modify: `src/renderer/src/stores/sessions.test.ts`

- [ ] **Step 1: SessionMeta / RecentSession 加 agent**

`src/renderer/src/types/session.ts` 的 `SessionMeta` 加：

```ts
  agent?: string
```

`src/renderer/src/types/recent.ts` 的 `RecentSession` 加：

```ts
  agent?: string
```

（主进程 `src/main/jsonl.ts` 的 `SessionMeta` 同步加 `agent?: string`——见 Task 3 Step 3 引用。）

- [ ] **Step 2: recentToMeta 透传 agent**

`src/renderer/src/stores/sessions.ts` 的 `recentToMeta` 返回对象加：

```ts
    agent: record.agent,
```

- [ ] **Step 3: create 透传 agent**

`src/renderer/src/stores/sessions.ts`：

```ts
  async function create(workdir: string, prompt: string, extraArgs: string[] = [], botId?: string, agent?: string) {
    creating.value = true
    try {
      const id = await CreateSession(workdir, prompt, extraArgs, agent)
      adopted.value = { ...adopted.value, [id]: true }
      state.value = { ...state.value, [id]: 'waiting' }
      if (!list.value.find(s => s.id === id)) {
        const project = workdir.split(/[\\/]/).filter(Boolean).pop() || workdir
        list.value = trimList([{
          id, workdir, project, mtime: Math.floor(Date.now() / 1000), msg_count: 0,
          first_prompt: prompt, ai_title: '', size: 0,
          user_title: undefined, title_source: 'first_prompt',
          agent,   // 新增
        }, ...list.value])
      }
      ...
```

- [ ] **Step 4: applyRebind 保留 agent**

`src/renderer/src/stores/sessions.ts` 的 `applyRebind` 中迁移列表项时保留 agent：

```ts
      list.value = trimList([
        ...list.value.slice(0, idx),
        {
          ...item,
          id: newId,
          workdir,
          project: workdir.split(/[\\/]/).filter(Boolean).pop() || workdir,
          user_title: undefined,
          ai_title: '',
          first_prompt: '',
          title_source: undefined,
          msg_count: 0,
          // agent 保留：/clear 后仍是同一 agent
        },
        ...list.value.slice(idx + 1),
      ])
```
（`...item` 展开已携带 agent，无需额外代码。此步骤仅确认不覆盖。）

- [ ] **Step 5: 更新 stores 单测**

`src/renderer/src/stores/sessions.test.ts` 追加：

```ts
import { recentToMeta } from './sessions'

describe('recentToMeta agent', () => {
  it('透传 agent', () => {
    const m = recentToMeta({ sessionId: 's', workdir: '/w', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle', agent: 'omp' })
    expect(m.agent).toBe('omp')
  })
  it('缺省 agent 为 undefined（前端回退 claude）', () => {
    const m = recentToMeta({ sessionId: 's', workdir: '/w', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'idle' })
    expect(m.agent).toBeUndefined()
  })
})
```

（若 `recentToMeta` 未从 store 导出，先补充 `export { MAX_SIDEBAR_SESSIONS, recentToMeta, trimList }`——该导出已存在。）

- [ ] **Step 6: 运行 renderer 测试**

Run: `cd src/renderer && npm test`
Expected: 新增 2 个用例 PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/types/session.ts src/renderer/src/types/recent.ts src/main/jsonl.ts src/renderer/src/stores/sessions.ts src/renderer/src/stores/sessions.test.ts
git commit -m "feat: 前端 SessionMeta/RecentSession agent 字段与透传"
```

---

### Task 5: NewSessionDialog 接入 AgentSelect

**Files:**
- Modify: `src/renderer/src/components/NewSessionDialog.vue`
- Modify: `src/renderer/src/views/HomeView.vue`

- [ ] **Step 1: NewSessionDialog 加 Agent 类型下拉**

`src/renderer/src/components/NewSessionDialog.vue`：

template 中新增（放在"工作目录" form-group 之后、"提示词"之前）：

```vue
          <div class="form-group">
            <label class="form-label">Agent 类型</label>
            <AgentSelect v-model="agent" />
          </div>
```

script 中：

```vue
import AgentSelect from './AgentSelect.vue'
import type { AgentKind } from '../types/agents'

const agent = ref<AgentKind>('claude')
```

emit 签名加 agent：

```ts
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create', workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind): void
  (e: 'open-recent', item: RecentSession): void
}>()
```

`onSubmit` 透传：

```ts
function onSubmit() {
  if (!workdir.value.trim() || props.loading) return
  emit('create', workdir.value.trim(), prompt.value.trim(), [...selectedFlags.value], selectedBot.value || undefined, agent.value)
}
```

watch 重置时 `agent.value = 'claude'`。

- [ ] **Step 2: 选项联动（非 claude 禁用 Claude 选项）**

`NewSessionDialog.vue` 的"Claude 选项" form-group 改为：

```vue
          <div class="form-group">
            <label class="form-label">{{ agent === 'claude' ? 'Claude 选项' : '启动选项' }}</label>
            <div v-if="agent === 'claude'" class="multi-select" :class="{ open: flagsOpen }">
              <!-- 原 multi-select 内容不变 -->
            </div>
            <div v-else class="option-disabled">该 agent 暂不支持额外参数</div>
          </div>
```

样式追加：

```css
.option-disabled {
  padding: 8px 10px; background: var(--bg-input); border: 1px dashed var(--border);
  border-radius: var(--radius-md); font-size: 12px; color: var(--text-tertiary);
}
```

prompt placeholder 动态：

```vue
            <textarea class="form-input area" v-model="prompt" rows="4" :placeholder="agent === 'claude' ? '你想让 Claude 做什么？' : `你想让 ${meta(agent).short} 做什么？`" :disabled="loading"></textarea>
```

script 引入 `meta` 辅助（可直接用 `agentMeta`）：

```vue
import { AGENT_KINDS, agentMeta } from '../types/agents'
const meta = (k: AgentKind) => agentMeta(k)
```

- [ ] **Step 3: HomeView 透传 agent**

`src/renderer/src/views/HomeView.vue` 的 `onCreateFromSession`（约 274 行 `sessions.create(workdir, prompt, extraArgs, botId)`）改为：

```ts
    const id = await sessions.create(workdir, prompt, extraArgs, botId, agent)
```
（`agent` 从 NewSessionDialog `@create` 事件的第 5 个参数取出；`onCreateFromSession(workdir, prompt, extraArgs, botId, agent)` 签名补第 5 参。）

- [ ] **Step 4: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/NewSessionDialog.vue src/renderer/src/views/HomeView.vue
git commit -m "feat: 新建会话支持选择 agent 类型（下拉 + 选项联动）"
```

---

### Task 6: 4 区域 AgentBadge 标识接入

**Files:**
- Modify: `src/renderer/src/components/SessionItem.vue`
- Modify: `src/renderer/src/components/SessionTabContent.vue`
- Modify: `src/renderer/src/components/GlobalTabs.vue`
- Modify: `src/renderer/src/components/RecentSessionList.vue`
- Modify: `src/renderer/src/components/SessionTooltip.vue`

- [ ] **Step 1: SessionItem avatar 换 AgentBadge**

`src/renderer/src/components/SessionItem.vue` template 中：

```vue
    <AgentBadge :agent="props.meta.agent" size="md" />
```

（原 `<div class="avatar">CC</div>` 删除；`.avatar` 样式可保留或删除。）

script：

```vue
import AgentBadge from './AgentBadge.vue'
```

- [ ] **Step 2: SessionTabContent loading 文案**

`src/renderer/src/components/SessionTabContent.vue`：

```vue
      <div class="loading-text">
        <AgentBadge :agent="agent" size="sm" />
        正在启动 {{ agentLabel }} 会话…
      </div>
```

script：

```vue
import AgentBadge from './AgentBadge.vue'
import { agentMeta } from '../types/agents'
import { useSessionsStore } from '../stores/sessions'

const sessions = useSessionsStore()
const agent = computed(() => sessions.list.find((s) => s.id === props.sessionId)?.agent)
const agentLabel = computed(() => agentMeta(agent.value).label)
```

- [ ] **Step 3: GlobalTabs tab 标签 AgentBadge**

`src/renderer/src/components/GlobalTabs.vue` 的 session tab 中，在 `.tab-title` 前加：

```vue
        <AgentBadge v-if="tab.type === 'session'" :agent="sessionAgent(tab.id)" size="sm" class="tab-agent" />
```

script：

```vue
import AgentBadge from './AgentBadge.vue'
function sessionAgent(tabId: string): string | undefined {
  const sid = sessionIdFromTab(tabId)
  if (!sid) return undefined
  return sessions.list.find((s) => s.id === sid)?.agent
}
```

样式（badge 缩小到 tab 高度内）：

```css
.tab-agent { width: 16px; height: 16px; border-radius: 4px; font-size: 8px; }
```

- [ ] **Step 4: RecentSessionList 项前置 AgentBadge**

`src/renderer/src/components/RecentSessionList.vue` template 中 `.status-dot` 后加：

```vue
      <AgentBadge :agent="item.agent" size="sm" class="recent-agent" />
```

script：

```vue
import AgentBadge from './AgentBadge.vue'
```

- [ ] **Step 5: SessionTooltip 显示 agent**

`src/renderer/src/components/SessionTooltip.vue` 顶部（Session ID 前）加：

```vue
    <div class="section" v-if="agentMeta(meta.agent).kind">
      <div class="agent-row">
        <AgentBadge :agent="meta.agent" size="sm" />
        <span class="value">{{ agentMeta(meta.agent).label }}</span>
      </div>
    </div>
```

script：

```vue
import AgentBadge from './AgentBadge.vue'
import { agentMeta } from '../types/agents'
```

- [ ] **Step 6: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit && npm test`
Expected: PASS（vue-tsc + 既有组件测试）

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/SessionItem.vue src/renderer/src/components/SessionTabContent.vue src/renderer/src/components/GlobalTabs.vue src/renderer/src/components/RecentSessionList.vue src/renderer/src/components/SessionTooltip.vue
git commit -m "feat: 会话列表/终端 tab/历史会话/tooltip 显示 agent 类型标识"
```

---

### Task 7: GeneralTab 每 agent 路径

**Files:**
- Modify: `src/renderer/src/types/settings.ts`
- Modify: `src/renderer/src/stores/settings.ts`
- Modify: `src/renderer/src/components/settings/GeneralTab.vue`
- Modify: `src/main/app.ts`（createSessionInternal 按 agent 读路径）

- [ ] **Step 1: Settings 类型加 agent 路径**

`src/renderer/src/types/settings.ts` 的 `Settings` 加：

```ts
  claude_path: string
  codex_path: string
  opencode_path: string
  omp_path: string
```

- [ ] **Step 2: settings store 默认值**

`src/renderer/src/stores/settings.ts` `defaultSettings()` 加：

```ts
    codex_path: '',
    opencode_path: '',
    omp_path: '',
```

（`GeneralTab.vue` 内联默认值对象同步加这三项。）

- [ ] **Step 3: GeneralTab 表单加 3 个路径**

`src/renderer/src/components/settings/GeneralTab.vue` 在"Claude CLI 路径" form-group 后加：

```vue
    <div class="form-group">
      <label class="form-label">Codex 路径</label>
      <input class="form-input" v-model="cfg.codex_path" @change="markDirty" placeholder="留空使用 PATH 中的 codex" />
      <p class="form-hint">自定义 Codex 可执行文件路径。留空则自动查找 PATH。</p>
    </div>
    <div class="form-group">
      <label class="form-label">OpenCode 路径</label>
      <input class="form-input" v-model="cfg.opencode_path" @change="markDirty" placeholder="留空使用 PATH 中的 opencode" />
      <p class="form-hint">自定义 OpenCode 可执行文件路径。留空则自动查找 PATH。</p>
    </div>
    <div class="form-group">
      <label class="form-label">OMP 路径</label>
      <input class="form-input" v-model="cfg.omp_path" @change="markDirty" placeholder="留空使用 PATH 中的 omp" />
      <p class="form-hint">自定义 OMP（oh-my-pi）可执行文件路径。留空则自动查找 PATH。</p>
    </div>
```

- [ ] **Step 4: 主进程按 agent 读路径**

`src/main/app.ts` `createSessionInternal` 中，`claudeBin` 改为按 spec.kind 读对应设置字段：

```ts
    const pathKey = `${spec.kind}_path` as 'claude_path' | 'codex_path' | 'opencode_path' | 'omp_path';
    const claudeBin = (this.settingsStore.get(pathKey, '') as string) || spec.command;
```

- [ ] **Step 5: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/types/settings.ts src/renderer/src/stores/settings.ts src/renderer/src/components/settings/GeneralTab.vue src/main/app.ts
git commit -m "feat: GeneralTab 每 agent 可执行路径配置"
```

---

### Task 8: ProviderTab 按 agent 分组（框架先行）

**Files:**
- Modify: `src/renderer/src/types/providers.ts`
- Modify: `src/renderer/src/stores/providers.ts`
- Modify: `src/renderer/src/components/settings/ProviderTab.vue`

- [ ] **Step 1: Provider 加 agent 字段**

`src/renderer/src/types/providers.ts`：

```ts
export interface Provider {
  id: string
  agent?: string        // 缺省 'claude'
  name: string
  base_url: string
  auth_token: string
  default_model: string
  default_haiku_model: string
  default_sonnet_model: string
  default_opus_model: string
  reasoning_model: string
}
```

- [ ] **Step 2: providers store 支持 agent 过滤**

`src/renderer/src/stores/providers.ts` `newProvider()` 加默认 agent：

```ts
function newProvider(agent?: string): Provider {
  return {
    id: crypto.randomUUID(),
    agent,
    name: '新供应商',
    base_url: '',
    ...
  }
}
```

`addProvider(agent?: string)` 传参：

```ts
  async function addProvider(agent?: string): Promise<string> {
    if (!cfg.value) cfg.value = defaultConfig()
    const p = newProvider(agent)
    cfg.value.providers.push(p)
    dirty.value = false
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
    return p.id
  }
```

- [ ] **Step 3: ProviderTab 左栏 agent 分组**

`src/renderer/src/components/settings/ProviderTab.vue`：

- 新增左栏顶部 agent 选择（复用 AgentSelect 或一组 tab 按钮），`selectedAgent = ref<string>('claude')`
- `providers` computed 改为按 `selectedAgent` 过滤：

```ts
const allProviders = computed(() => store.cfg?.providers ?? [])
const providers = computed(() => allProviders.value.filter(p => (p.agent || 'claude') === selectedAgent.value))
```

- `onAdd` 传 `selectedAgent.value`：

```ts
async function onAdd() {
  try {
    selectedId.value = await store.addProvider(selectedAgent.value)
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '新增失败：' + (e?.message ?? e) })
  }
}
```

- 非 claude 且该 agent 无 provider 时，右栏显示空状态：

```vue
    <section v-if="provider" class="provider-form"><!-- 现有编辑表单 --></section>
    <section v-else class="provider-form empty-state">
      该 agent 的供应商配置待支持
    </section>
```

- [ ] **Step 4: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/types/providers.ts src/renderer/src/stores/providers.ts src/renderer/src/components/settings/ProviderTab.vue
git commit -m "feat: ProviderTab 按 agent 分组（框架先行，claude 完整迁移）"
```

---

### Task 9: 回归验证

**Files:**
- 无新文件（验证类）

- [ ] **Step 1: 主进程测试**

Run: `npm run test:main`
Expected: 全部通过（已知 3 个本机环境失败除外：store/wecom-channel-cards 的 Electron 未安装、pty 的 posix_spawnp——与本计划无关）

- [ ] **Step 2: renderer 类型检查 + 组件测试**

Run: `cd src/renderer && npx vue-tsc --noEmit && npm test`
Expected: 全绿

- [ ] **Step 3: 全量构建验证（可选）**

Run: `npm run build:frontend`
Expected: 构建成功

- [ ] **Step 4: Commit（如有遗漏改动）**

```bash
git status
git add <遗漏文件>
git commit -m "chore: 多 Agent UI 回归"
```

---

## 自审结论

- **Spec 覆盖**：AGENT_META（Task1）、组件（Task2）、主进程数据（Task3）、前端数据（Task4）、NewSessionDialog+联动（Task5）、4 区域标识（Task6）、每 agent 路径（Task7）、ProviderTab 分组（Task8）、回归（Task9）。网关支持说明属后端 adapter 补全（独立计划），不在此 UI 计划内。
- **类型一致性**：`AgentKind` 前后端同字面量；`agent` 字段贯穿 SessionMeta/RecentSession/RecentSessionRecord；`agentMeta()` 缺省回退 claude。
- **无占位符**：所有步骤含完整代码与运行命令。
