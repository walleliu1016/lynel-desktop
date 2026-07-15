<template>
  <div class="titlebar">
    <div class="titlebar-left">
      <span class="brand-name"><span class="brand-lynel">Lynel</span> <span class="brand-desktop">Desktop</span></span>
      <div v-if="runningCount > 0" class="states">
        <span class="pill run"><i />{{ runningCount }} 个 Session 运行中</span>
      </div>
    </div>
    <div class="titlebar-right">
      <button class="iconbtn" title="设置" @click="$emit('settings')">
        <Icon name="settings" :size="14" />
      </button>
      <div class="account">
        <span class="avatar">{{ avatar }}</span>
        <div class="info">
          <b>{{ username }}</b>
          <span>本地</span>
        </div>
      </div>
      <div class="win-btns">
        <button class="win-btn" @click="minimize" title="最小化">
          <Icon name="minimize" :size="14" />
        </button>
        <button class="win-btn" :title="isMaximized ? '还原' : '最大化'" @click="toggleMaximize">
          <Icon :name="isMaximized ? 'restore' : 'maximize'" :size="14" />
        </button>
        <button class="win-btn close" @click="hide" title="隐藏到托盘">
          <Icon name="close" :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useWindowState } from '../composables/useWindowState'
import { useSessionsStore } from '../stores/sessions'
import Icon from './Icon.vue'

const props = defineProps<{ username?: string }>()
defineEmits<{ (e: 'settings'): void }>()

const { isMaximized, minimize, toggleMaximize, hide } = useWindowState()
const sessions = useSessionsStore()

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
</script>

<style scoped>
.titlebar {
  height: 56px;
  background: rgba(255, 255, 255, 0.96);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  --wails-draggable: drag;
  user-select: none;
}
.titlebar-left, .titlebar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  -webkit-app-region: no-drag;
}
.titlebar-left { gap: 24px; }
.brand-name { font-weight: 800; font-size: 18px; color: var(--accent); letter-spacing: -0.3px; }
.brand-desktop { font-weight: 500; color: var(--text-tertiary); }
.states { display: flex; align-items: center; gap: 8px; }
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
.account {
  display: flex; align-items: center; gap: 8px;
  padding-left: 12px; border-left: 1px solid var(--border);
}
.avatar {
  width: 28px; height: 28px; border-radius: 8px;
  background: var(--text-primary); color: white;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 800;
}
.info { display: flex; flex-direction: column; }
.info b { font-size: 11px; color: var(--text-primary); }
.info span { font-size: 10px; color: var(--text-tertiary); }
.win-btns { display: flex; align-items: center; gap: 2px; margin-left: 8px; }
.win-btn {
  width: 28px; height: 20px; border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
}
.win-btn:hover { background: rgba(0,0,0,0.06); }
.win-btn.close:hover { background: var(--status-error); color: white; }
</style>
