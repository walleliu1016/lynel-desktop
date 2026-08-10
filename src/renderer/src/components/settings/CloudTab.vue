<template>
  <div class="cloud-tab">
    <div class="row toggle">
      <label class="k">启用</label>
      <div class="v">
        <Switch v-model="cfg.cloud_service_enabled" @change="markDirty" />
      </div>
    </div>

    <div class="row">
      <label class="k">服务地址</label>
      <input class="v" v-model="cfg.cloud_service_url" @change="markDirty" :disabled="!cfg.cloud_service_enabled" placeholder="https://ease.example.com" />
    </div>

    <div class="row">
      <label class="k">连接状态</label>
      <div class="v status-row">
        <span class="dot" :class="statusClass" />
        <span class="status-label">{{ statusText }}</span>
      </div>
    </div>

    <div class="actions">
      <div class="spacer" />
      <button class="cancel" :disabled="!settings.dirty" @click="settings.load">取消</button>
      <button class="save" :disabled="!settings.dirty" @click="onSave">保存</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue'
import Switch from '../../components/Switch.vue'
import { useSettingsStore } from '../../stores/settings'
import { CloudConnectionState } from '../../composables/useElectron'

const settings = useSettingsStore()
const cfg = computed(() => settings.cfg ?? (settings.cfg = {
  theme: 'light',
  claude_path: '',
  log_enabled: false,
  auto_lock_minutes: 5,
  auto_start: false,
  minimize_on_start: false,
  cloud_service_enabled: false,
  cloud_service_url: '',
} as any))

interface ConnState { state: string; reconnectAttempt: number }
const connState = ref<ConnState>({ state: 'disconnected', reconnectAttempt: 0 })
let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await settings.load()
  startPolling()
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

function markDirty() { settings.markDirty() }

async function onSave() {
  try { await settings.save() }
  catch (e: any) { alert('保存失败：' + (e?.message ?? e)) }
  // 保存后立刻刷新一次状态
  refreshState()
}

function startPolling() {
  refreshState()
  // 2s 轮询：socket 重连/认证是异步过程，需要持续刷新
  pollTimer = setInterval(refreshState, 2000)
}

async function refreshState() {
  try {
    const s = await CloudConnectionState()
    connState.value = s as ConnState
  } catch {
    // ignore
  }
}

const statusClass = computed(() => {
  if (!cfg.value.cloud_service_enabled) return ''
  switch (connState.value.state) {
    case 'authenticated':
    case 'connected':
      return 'ok'
    case 'auth_failed': return 'fail'
    case 'connecting':
    case 'reconnecting': return 'testing'
    default: return ''
  }
})

const statusText = computed(() => {
  if (!cfg.value.cloud_service_enabled) return '未启用'
  switch (connState.value.state) {
    case 'connecting': return '连接中...'
    case 'connected': return '已连接'
    case 'authenticated': return '已连接'
    case 'auth_failed': return '认证失败'
    case 'reconnecting': return `重连中(${connState.value.reconnectAttempt})`
    default: return '未连接'
  }
})
</script>

<style scoped>
.cloud-tab { padding: 20px 24px; max-width: 600px; }
.notice {
  display: flex; gap: 10px; align-items: center;
  padding: 10px 14px; background: var(--accent-soft-bg);
  border: 1px solid var(--accent-soft-border); border-radius: var(--radius-md);
  margin-bottom: 20px; font-size: 12px;
}
.badge {
  background: var(--accent); color: white;
  padding: 2px 8px; border-radius: var(--radius-sm); font-size: 10px; font-weight: 600;
}
.row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
.k { width: 140px; font-size: 12px; color: var(--text-primary); padding-top: 6px; }
.v { flex: 1; }
.v > input, .v > select {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 6px 10px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
}
.v > input:disabled, .v > select:disabled { opacity: 0.5; }
.v > input:focus, .v > select:focus { outline: none; border-color: var(--accent); }
.status-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.status-label { font-size: 12px; color: var(--text-tertiary); min-width: 56px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
.dot.ok { background: #22c55e !important; box-shadow: 0 0 6px rgba(34,197,94,.4); }
.dot.fail { background: #ef4444 !important; }
.dot.testing { background: #f59e0b !important; animation: pulse 0.8s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.toggle .v { display: flex; }
.actions { display: flex; align-items: center; gap: 8px; margin-top: 24px; }
.spacer { flex: 1; }
.save { padding: 6px 16px; background: var(--accent); color: white; border-radius: var(--radius-md); }
.save:hover:not(:disabled) { background: var(--accent-light); }
.cancel { padding: 6px 16px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-md); }
.save:disabled, .cancel:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
