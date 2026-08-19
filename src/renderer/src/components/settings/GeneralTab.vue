<template>
  <div class="general-tab">
    <h2>通用设置</h2>

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

    <div class="form-group">
      <label class="form-label">Agent 可执行文件路径</label>
      <div class="agent-path-rows">
        <div v-for="k in settings.enabledAgentKinds" :key="k" class="agent-path-row">
          <span class="agent-path-name" :class="'a-' + k">{{ agentMeta(k).short }}</span>
          <input class="form-input" :value="pathOf(k)" @input="onPathInput(k, $event)" :placeholder="`留空使用 PATH 中的 ${k}`" />
        </div>
      </div>
      <p class="form-hint">自定义各 agent 可执行文件路径。留空则自动查找 PATH。</p>
    </div>

    <div class="form-group">
      <label class="form-label">自动锁定</label>
      <select class="form-select" v-model.number="cfg.auto_lock_minutes" @change="markDirty">
        <option :value="1">1 分钟</option>
        <option :value="5">5 分钟</option>
        <option :value="10">10 分钟</option>
        <option :value="30">30 分钟</option>
        <option :value="60">60 分钟</option>
        <option :value="0">关闭</option>
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">开关</label>
      <div class="switch-list">
        <label class="switch-row">
          <span class="switch-label">启用日志</span>
          <Switch v-model="cfg.log_enabled" @change="markDirty" />
        </label>
        <label class="switch-row">
          <span class="switch-label">启动时自启</span>
          <Switch v-model="cfg.auto_start" @change="markDirty" />
        </label>
        <label class="switch-row">
          <span class="switch-label">启动时最小化</span>
          <Switch v-model="cfg.minimize_on_start" @change="markDirty" />
        </label>
        <label class="switch-row">
          <span class="switch-label">推送思考过程</span>
          <Switch v-model="cfg.push_thinking" @change="markDirty" />
        </label>
        <label class="switch-row">
          <span class="switch-label">推送工具调用</span>
          <Switch v-model="cfg.push_tool_calls" @change="markDirty" />
        </label>
        <label class="switch-row">
          <span class="switch-label">防止系统休眠</span>
          <Switch v-model="cfg.prevent_sleep" @change="markDirty" />
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import Switch from '../../components/Switch.vue'
import { useSettingsStore } from '../../stores/settings'
import { agentMeta, type AgentKind } from '../../types/agents'

const settings = useSettingsStore()
const cfg = computed(() => settings.cfg ?? (settings.cfg = {
  theme: 'light',
  claude_path: '',
  codex_path: '',
  opencode_path: '',
  omp_path: '',
  codex_enabled: false,
  opencode_enabled: false,
  omp_enabled: false,
  log_enabled: false,
  auto_lock_minutes: 5,
  auto_start: false,
  minimize_on_start: false,
  cloud_service_enabled: false,
  cloud_service_url: '',
  push_thinking: false,
  push_tool_calls: false,
  prevent_sleep: false,
} as any))

// 每个启用的 agent 一行：标签 + 路径输入，独立读写各自 <kind>_path
function pathOf(k: AgentKind): string {
  return (cfg.value as any)[`${k}_path`] ?? ''
}
function onPathInput(k: AgentKind, e: Event) {
  ;(cfg.value as any)[`${k}_path`] = (e.target as HTMLInputElement).value
  markDirty()
}

onMounted(() => settings.load())
function markDirty() { settings.markDirty() }
</script>

<style scoped>
.general-tab { padding: 20px 24px; max-width: 560px; }
h2 { font-size: 16px; color: var(--text-primary); font-weight: 600; margin-bottom: 20px; }

.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
.form-input, .form-select {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: 13px; font-family: inherit;
}
.form-input:focus, .form-select:focus { outline: none; border-color: var(--accent); }
.form-input::placeholder { color: var(--text-tertiary); }
.form-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }

.agent-path-rows { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.agent-path-row { display: flex; align-items: center; gap: 10px; }
.agent-path-row .form-input { flex: 1; min-width: 0; }
.agent-path-name { width: 84px; flex-shrink: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
.agent-path-name.a-claude { color: var(--agent-claude-fg); }
.agent-path-name.a-codex { color: var(--agent-codex-fg); }
.agent-path-name.a-opencode { color: var(--agent-opencode-fg); }
.agent-path-name.a-omp { color: var(--agent-omp-fg); }

.switch-list { display: flex; flex-direction: column; gap: 2px; }
.switch-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: var(--radius-md); cursor: pointer;
}
.switch-row:hover { background: var(--bg-hover); }
.switch-label { font-size: 13px; color: var(--text-primary); }
</style>
