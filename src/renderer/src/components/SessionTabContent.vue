<template>
  <div class="session-tab-content">
    <div v-if="loading" class="terminal-area-loading">
      <div ref="spinnerEl" class="spinner-static" />
      <div class="loading-text">
        <AgentBadge :agent="agent" size="sm" />
        正在启动 {{ agentLabel }} 会话…
      </div>
      <!-- 加载遮罩内的 Buddy：不传 state，缺省 idle 帧陪伴 -->
      <BuddyHost :session-id="sessionId" />
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
      :id="permissionRequestId"
    />
    <!--
      等待审批专属 Buddy：alarm 帧 + 等待吐槽。
      v-if="!loading && isAwaitingPermission" 门控：若 loading 与 awaiting 同时成立
      （启动期就触发权限），会与加载遮罩内的 BuddyHost 并存成双实例，导致同一 session
      的请求/错误事件被重复累计。保证同一 session 同一时刻只有一个 BuddyHost 实例。
    -->
    <BuddyHost
      v-if="!loading && isAwaitingPermission"
      :session-id="sessionId"
      state="awaiting_permission"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import AgentBadge from './AgentBadge.vue'
import XtermTerminal from './XtermTerminal.vue'
import PermissionToast from './PermissionToast.vue'
import BuddyHost from './buddy/BuddyHost.vue'
import { useSessionsStore } from '../stores/sessions'
import { agentMeta } from '../types/agents'
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

const agent = computed(() => sessions.list.find((s) => s.id === props.sessionId)?.agent)
const agentLabel = computed(() => agentMeta(agent.value).label)

/** 会话是否处于等待审批状态：作为 Buddy alarm 帧与等待吐槽的显示门控 */
const isAwaitingPermission = computed(() => sessions.state[props.sessionId] === 'awaiting_permission')

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
  return req?.id || ''
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
.loading-text { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-body-sm); }
</style>

<style>
.spinner-static {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
}
</style>
