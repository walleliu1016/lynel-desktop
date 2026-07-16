<template>
  <div class="session-tab-content">
    <div v-if="loading" class="terminal-area-loading">
      <div ref="spinnerEl" class="spinner-static" />
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
import { computed, ref, watch, onBeforeUnmount } from 'vue'
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
const spinnerEl = ref<HTMLElement | null>(null)
let spinnerRaf = 0

function runSpinner() {
  if (!spinnerEl.value) return
  let deg = 0
  const step = () => {
    if (!spinnerEl.value) return
    deg = (deg + 6) % 360
    spinnerEl.value.style.transform = `rotate(${deg}deg)`
    spinnerRaf = requestAnimationFrame(step)
  }
  step()
}

function killSpinner() {
  if (spinnerRaf) { cancelAnimationFrame(spinnerRaf); spinnerRaf = 0 }
}

watch(loading, (v) => {
  if (v) {
    killSpinner()
    requestAnimationFrame(() => runSpinner())
  } else {
    killSpinner()
  }
})

onBeforeUnmount(() => killSpinner())

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
.loading-text { font-size: 12px; }
</style>

<style>
.spinner-static {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
}
</style>
