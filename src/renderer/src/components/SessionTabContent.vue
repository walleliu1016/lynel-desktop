<template>
  <div class="session-tab-content">
    <div v-if="loading" class="terminal-area-loading">
      <div class="spinner" />
      <div class="loading-text">正在启动 Claude 会话…</div>
    </div>
    <XtermTerminal
      :session-id="sessionId"
      :workdir="workdir"
      :visible="visible"
      @starting="loading = true"
      @ready="loading = false"
      @data="onTerminalData"
    />
    <PermissionToast
      :tool-name="permissionToastName"
      :tool-input="permissionToolInput"
      :session-id="sessionId"
      :request-id="permissionRequestId"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import XtermTerminal from './XtermTerminal.vue'
import PermissionToast from './PermissionToast.vue'
import { useSessionsStore } from '../stores/sessions'
import { WriteTerminalInput } from '../composables/useElectron'

const props = withDefaults(defineProps<{
  sessionId: string
  workdir: string
  visible?: boolean
}>(), {
  visible: true,
})

const sessions = useSessionsStore()
const loading = ref(false)

const permissionToastName = computed(() => {
  const req = sessions.hookPermissions[props.sessionId]
  return req?.toolName || ''
})

const permissionRequestId = computed(() => {
  const req = sessions.hookPermissions[props.sessionId]
  return req?.requestId || ''
})

const permissionToolInput = computed(() => {
  const req = sessions.hookPermissions[props.sessionId]
  return req?.toolInput as Record<string, unknown> | undefined
})

async function onTerminalData(data: string) {
  try {
    await WriteTerminalInput(props.sessionId, data)
  } catch (e: any) {
    console.error('[terminal] write failed:', e?.message)
  }
}
</script>

<style scoped>
.session-tab-content {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-terminal);
  padding-left: 8px;
  border-left: 1px solid var(--border-strong, var(--border));
}
.terminal-area-loading {
  position: absolute;
  z-index: 30;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
  background: var(--bg-terminal-loading);
  pointer-events: none;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.loading-text { font-size: 12px; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
