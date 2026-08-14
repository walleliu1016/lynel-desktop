# 通用设置 Agent 路径 Tab 切换实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将通用设置 4 个 agent 路径输入收进 tab 切换（一次显示当前 agent），并把模型供应商页 agent-switch 的字母缩写改为实际 logo，节省空间并统一 agent 标识。

**Architecture:** 单前端改动。`GeneralTab.vue` 引入 `AGENT_KINDS` / `AGENT_LOGOS`，用 tab 组 + 动态 computed 绑定当前 agent 的路径字段；`ProviderTab.vue` 的 agent-switch 用 `AgentBadge` 渲染 logo。纯展示层，无主进程与 store 改动。

**Tech Stack:** Vue 3 (`<script setup>`)、`agentLogos.ts`（SVG logo）、`AgentBadge.vue`、CSS 变量主题。

## Global Constraints

- 所有注释用简体中文。
- logo 必须复用 `agentLogos.ts` / `AgentBadge.vue`，禁止 emoji / Unicode 当图标。
- 激活态用 `--agent-*-bg` / `--agent-*-fg` 标识色，不引入新色值。
- 提交需用户明确要求；不得主动执行 git commit / branch 操作。
- commit 前必须 `cd src/renderer && npx vue-tsc --noEmit` 通过。

---

### Task 1: GeneralTab.vue 路径区改为 Agent Tab 切换

**Files:**
- Modify: `src/renderer/src/components/settings/GeneralTab.vue`

**Interfaces:**
- Consumes: `AGENT_KINDS` / `agentMeta` / `AgentKind`（`../types/agents`）、`AGENT_LOGOS`（`../agentLogos`）。
- Produces: `selectedAgent: Ref<AgentKind>`（默认 `'claude'`）、`selectedPath: ComputedRef<string>`（按 `selectedAgent` 读写 `cfg.<agent>_path`）。

- [ ] **Step 1: script 引入依赖与状态**

```ts
import { onMounted, computed, ref } from 'vue'
import Switch from '../../components/Switch.vue'
import { useSettingsStore } from '../../stores/settings'
import { pushToast } from '../../composables/useToast'
import { AGENT_KINDS, agentMeta, type AgentKind } from '../../types/agents'
import { AGENT_LOGOS } from '../../agentLogos'
```

在 `cfg` computed 后新增：

```ts
const selectedAgent = ref<AgentKind>('claude')
const selectedPath = computed({
  get: () => (cfg.value as any)[`${selectedAgent.value}_path`] ?? '',
  set: (v: string) => { (cfg.value as any)[`${selectedAgent.value}_path`] = v },
})
```

- [ ] **Step 2: 模板替换 4 个路径 form-group**

```vue
<div class="form-group">
  <label class="form-label">Agent 可执行文件路径</label>
  <div class="agent-path-tabs">
    <button
      v-for="k in AGENT_KINDS"
      :key="k"
      class="agent-path-tab"
      :class="['a-' + k, { active: selectedAgent === k }]"
      @click="selectedAgent = k"
    >
      <svg class="agent-path-logo" :viewBox="AGENT_LOGOS[k].viewBox" v-html="AGENT_LOGOS[k].inner" />
      <span>{{ agentMeta(k).short }}</span>
    </button>
  </div>
  <input class="form-input" v-model="selectedPath" @change="markDirty" :placeholder="`留空使用 PATH 中的 ${selectedAgent}`" />
  <p class="form-hint">自定义 {{ agentMeta(selectedAgent).label }} 可执行文件路径。留空则自动查找 PATH。</p>
</div>
```

- [ ] **Step 3: 追加 tab 与 logo 样式**

```css
.agent-path-tabs { display: flex; gap: 6px; margin-bottom: 10px; }
.agent-path-tab {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 0; font-size: 12px; font-weight: 600;
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-input); color: var(--text-tertiary); cursor: pointer;
  font-family: inherit;
}
.agent-path-tab:hover { border-color: var(--border-strong); color: var(--text-primary); }
.agent-path-tab.active { border-color: transparent; }
.agent-path-logo { width: 16px; height: 16px; flex-shrink: 0; }
.agent-path-tab.a-claude.active { background: var(--agent-claude-bg); color: var(--agent-claude-fg); }
.agent-path-tab.a-codex.active { background: var(--agent-codex-bg); color: var(--agent-codex-fg); }
.agent-path-tab.a-opencode.active { background: var(--agent-opencode-bg); color: var(--agent-opencode-fg); }
.agent-path-tab.a-omp.active { background: var(--agent-omp-bg); color: var(--agent-omp-fg); }
```

- [ ] **Step 4: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无类型错误，退出码 0。

- [ ] **Step 5: 手动验证（全栈 dev 模式）**

Run: `npm run dev`（或已有 dev 进程）。设置 → 通用：默认选中 Claude，切换 4 个 tab 显示对应输入框；输入路径后保存 dirty 状态正常；切换 tab 各值独立。

### Task 2: ProviderTab.vue agent-switch 改用实际 logo

**Files:**
- Modify: `src/renderer/src/components/settings/ProviderTab.vue`

**Interfaces:**
- Consumes: `AGENT_KINDS`（`../types/agents`）、`AgentBadge`（`../../components/AgentBadge.vue`）。
- Produces: agent-switch 按钮用 `AgentBadge` 渲染 16px logo，激活态用 agent 标识色。

- [ ] **Step 1: 引入 AgentBadge**

```ts
import AgentBadge from '../../components/AgentBadge.vue'
```

并将 `import { AGENT_KINDS, agentMeta } from '../../types/agents'` 中的 `agentMeta` 移除（不再使用）。

- [ ] **Step 2: 模板改为 logo**

```vue
<button
  v-for="k in AGENT_KINDS"
  :key="k"
  class="agent-btn"
  :class="['a-' + k, { active: selectedAgent === k }]"
  @click="onSwitchAgent(k)"
>
  <AgentBadge :agent="k" size="sm" />
</button>
```

- [ ] **Step 3: 更新按钮样式**

```css
.agent-btn {
  flex: 1; padding: 6px 0; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-input); cursor: pointer;
}
.agent-btn:hover { border-color: var(--accent); }
.agent-btn.active { border-color: transparent; }
.agent-btn.a-claude.active { background: var(--agent-claude-bg); }
.agent-btn.a-codex.active { background: var(--agent-codex-bg); }
.agent-btn.a-opencode.active { background: var(--agent-opencode-bg); }
.agent-btn.a-omp.active { background: var(--agent-omp-bg); }
```

- [ ] **Step 4: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无类型错误，退出码 0。

- [ ] **Step 5: 手动验证**

模型供应商页：左侧 4 个 logo 按钮切换正常，激活 tab 高亮 agent 标识色；切换到各 agent 分组显示对应供应商列表。
