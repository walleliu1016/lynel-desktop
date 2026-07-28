<template>
  <div class="titlebar" :class="{ 'is-mac': isMac, center: props.center }">
    <div class="titlebar-left">
      <span v-if="!props.center" class="brand-name"><span class="brand-lynel">Lynel</span> <span class="brand-desktop">Desktop</span></span>
      <div v-if="runningCount > 0" class="states">
        <span class="pill run"><i />{{ runningCount }} 个 Session 运行中</span>
      </div>
    </div>
    <div class="titlebar-right">
      <button v-if="props.showGuide" class="iconbtn" aria-label="使用指南" title="使用指南" @click="$emit('guide')">
        <Icon name="help" :size="14" />
      </button>
      <div v-if="cloudEnabled && !props.hideCloud" class="cloud-status" :class="cloudStatusClass" :title="cloudStatusTitle">
        <span class="dot" />
        <span class="label">{{ cloudStatusText }}</span>
      </div>
      <button v-if="!props.hideSettings" class="iconbtn" aria-label="设置" title="设置" @click="$emit('settings')">
        <Icon name="settings" :size="14" />
      </button>
      <div v-if="props.username" class="account">
        <span class="avatar" aria-hidden="true">{{ avatar }}</span>
        <div class="info">
          <b>{{ username }}</b>
          <span>本地</span>
        </div>
        <button v-if="!props.hideLogout" class="logout-btn" aria-label="退出登录" title="退出登录" @click="$emit('logout')">
          <Icon name="log-out" :size="13" />
        </button>
      </div>
      <div v-if="!isMac" class="win-btns">
        <button class="win-btn" aria-label="最小化" title="最小化" @click="minimize">
          <Icon name="minimize" :size="14" />
        </button>
        <button class="win-btn" :aria-label="isMaximized ? '还原' : '最大化'" :title="isMaximized ? '还原' : '最大化'" @click="toggleMaximize">
          <Icon :name="isMaximized ? 'restore' : 'maximize'" :size="14" />
        </button>
        <button class="win-btn close" aria-label="隐藏到托盘" title="隐藏到托盘" @click="hide">
          <Icon name="close" :size="14" />
        </button>
      </div>
    </div>
    <span v-if="props.center" class="titlebar-brand-center">
      <span class="brand-lynel">Lynel</span> <span class="brand-desktop">Desktop</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useWindowState } from '../composables/useWindowState'
import { useSessionsStore } from '../stores/sessions'
import { CloudConnectionState, GetSettings } from '../composables/useElectron'
import Icon from './Icon.vue'

const props = defineProps<{ username?: string; showGuide?: boolean; center?: boolean; hideSettings?: boolean; hideCloud?: boolean; hideLogout?: boolean }>()
defineEmits<{ (e: 'settings'): void; (e: 'guide'): void; (e: 'logout'): void }>()

const { isMaximized, minimize, toggleMaximize, hide } = useWindowState()
const sessions = useSessionsStore()

const isMac = computed(() => navigator.platform.toLowerCase().includes('mac'))

const avatar = computed(() => {
  const name = props.username || ''
  return name.slice(0, 2).toUpperCase() || 'U'
})

const runningCount = computed(() => {
  let count = 0
  for (const [id, st] of Object.entries(sessions.state)) {
    if (st !== 'idle' && st !== 'done' && st !== 'ended') count++
  }
  return count
})

// 云服务连接状态：仅 cloud_service_enabled 时显示
const cloudEnabled = ref(false)
interface CloudStateInfo { state: string; reconnectAttempt: number }
const cloudState = ref<CloudStateInfo>({ state: 'disconnected', reconnectAttempt: 0 })
let cloudPollTimer: ReturnType<typeof setInterval> | null = null

const cloudStatusClass = computed(() => {
  switch (cloudState.value.state) {
    case 'authenticated':
    case 'connected':
      return 'ok'
    case 'auth_failed': return 'fail'
    case 'connecting':
    case 'reconnecting': return 'testing'
    default: return ''
  }
})

const cloudStatusText = computed(() => {
  switch (cloudState.value.state) {
    case 'connecting': return '连接中'
    case 'connected': return '已连接'
    case 'authenticated': return '已连接'
    case 'auth_failed': return '认证失败'
    case 'reconnecting': return `重连中(${cloudState.value.reconnectAttempt})`
    default: return '未连接'
  }
})

const cloudStatusTitle = computed(() => `云服务：${cloudStatusText.value}`)

async function refreshCloudState() {
  try {
    const s = await CloudConnectionState()
    cloudState.value = s as CloudStateInfo
  } catch {}
}

onMounted(async () => {
  try {
    const cfg = await GetSettings()
    cloudEnabled.value = !!cfg.cloud_service_enabled
  } catch {}
  if (cloudEnabled.value) {
    refreshCloudState()
    // 2s 轮询：socket 重连/认证是异步过程，需要持续刷新
    cloudPollTimer = setInterval(refreshCloudState, 2000)
  }
})

onBeforeUnmount(() => {
  if (cloudPollTimer) {
    clearInterval(cloudPollTimer)
    cloudPollTimer = null
  }
})
</script>

<style scoped>
.titlebar {
  height: 64px;
  background: var(--bg-titlebar);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  --wails-draggable: drag;
  user-select: none;
  position: relative;
}
.titlebar-left, .titlebar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  -webkit-app-region: no-drag;
}
.titlebar-left { gap: 16px; }
.brand-name { font-weight: 800; font-size: 18px; color: var(--accent); letter-spacing: -0.3px; transform: translateY(10px); }
.brand-desktop { font-weight: 500; color: var(--status-error); }
.states { display: flex; align-items: center; gap: 8px; transform: translateY(10px); }
.pill {
  height: 28px; padding: 0 10px;
  display: flex; align-items: center; gap: 6px;
  border-radius: 20px; font-size: 11px; font-weight: 650;
}
.pill i { width: 6px; height: 6px; border-radius: 50%; }
.pill.run { border: 1px solid #a7f3d0; background: var(--status-success-soft); color: #047857; }
.pill.run i { background: var(--status-success); }
.iconbtn {
  width: 32px; height: 32px;
  border: 1px solid var(--border); border-radius: 9px;
  background: var(--bg-panel); color: var(--text-secondary);
  display: flex; align-items: center; justify-content: center;
}
.iconbtn:hover { color: var(--text-primary); border-color: var(--accent); }
.cloud-status {
  display: flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px;
  border-radius: 20px; font-size: 11px; font-weight: 600;
  border: 1px solid var(--border);
  background: var(--bg-panel); color: var(--text-secondary);
}
.cloud-status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
.cloud-status.ok { border-color: #a7f3d0; background: var(--status-success-soft); color: #047857; }
.cloud-status.ok .dot { background: var(--status-success); box-shadow: 0 0 6px rgba(34,197,94,.4); }
.cloud-status.fail { border-color: #fecaca; background: rgba(239,68,68,.08); color: #b91c1c; }
.cloud-status.fail .dot { background: #ef4444; }
.cloud-status.testing { border-color: #fde68a; background: rgba(245,158,11,.08); color: #b45309; }
.cloud-status.testing .dot { background: #f59e0b; animation: cloud-pulse 0.8s infinite; }
@keyframes cloud-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.account {
  display: flex; align-items: center; gap: 8px;
  padding-left: 12px; border-left: 1px solid var(--border);
}
.avatar {
  width: 28px; height: 28px; border-radius: 8px;
  background: var(--accent); color: white;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 800;
}
.info { display: flex; flex-direction: column; }
.info b { font-size: 11px; color: var(--text-primary); }
.info span { font-size: 10px; color: var(--text-tertiary); }
.logout-btn {
  width: 22px; height: 22px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  margin-left: 4px;
}
.logout-btn:hover { color: var(--status-error); background: rgba(239,68,68,.08); }
.win-btns { display: flex; align-items: center; gap: 2px; margin-left: 8px; }
.win-btn {
  width: 32px; height: 26px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.win-btn:hover { background: rgba(0,0,0,0.06); }
.win-btn:active { background: rgba(0,0,0,0.10); }
.win-btn.close:hover { background: var(--status-error); color: white; }
.win-btn.close:active { background: var(--status-error); filter: brightness(0.9); }
.is-mac .titlebar { padding-left: 90px; }
.titlebar.center .titlebar-left { visibility: hidden; }
.titlebar-brand-center {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  margin-top: 10px;
  font-weight: 800;
  font-size: 18px;
  letter-spacing: -0.3px;
  pointer-events: none;
  user-select: none;
}
.titlebar-brand-center .brand-lynel { color: var(--accent); }
.titlebar-brand-center .brand-desktop { font-weight: 500; color: var(--status-error); }
</style>
