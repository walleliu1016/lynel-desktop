<template>
  <div class="home">
    <TitleBar
      :is-maximized="isMaximized"
      @minimize="onMinimize"
      @maximize="onMaximize"
      @restore="onRestore"
      @close="onClose"
    />
    <div class="layout">
      <aside class="left">
        <SessionList :list="sessions.list" :active-id="sessions.activeId"
                     @create="showNew = true" @select="sessions.select" />
        <UserBar :username="username" :version="version" @settings="goSettings" />
      </aside>
      <main class="right">
        <template v-if="sessions.active">
          <ToolBar
            :title="displayName"
            :ai-title="sessions.active?.ai_title"
            :project="sessions.active.project"
            :session-id="sessions.active.id"
            :msg-count="sessions.active.msg_count"
            :state="state"
          />
          <div class="terminal-area">
            <XtermTerminal
              v-for="session in openedTerminals"
              v-show="session.id === sessions.activeId"
              :key="session.id"
              :session-id="session.id"
              :workdir="session.workdir"
              :visible="session.id === sessions.activeId"
              @data="onTerminalData(session.id, $event)"
            />
          </div>
        </template>
        <div v-else class="empty">
          <div class="empty-text">选择左侧会话，或点击 + 创建新会话</div>
        </div>
      </main>
      <ToolTimeline
        v-model:collapsed="timelineCollapsed"
        :executions="sessions.executions"
        :active-id="sessions.activeId"
      />
    </div>
    <NewSessionDialog
      :open="showNew"
      :loading="sessions.creating"
      @close="showNew = false"
      @create="onCreate"
    />
    <PermissionToast
      :tool-name="permissionToastName"
      :session-id="sessions.activeId || ''"
      @navigate="navigateToSession"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import SessionList from '../components/SessionList.vue'
import UserBar from '../components/UserBar.vue'
import ToolBar from '../components/ToolBar.vue'
import XtermTerminal from '../components/XtermTerminal.vue'
import NewSessionDialog from '../components/NewSessionDialog.vue'
import ToolTimeline from '../components/ToolTimeline.vue'
import PermissionToast from '../components/PermissionToast.vue'
import { useSessionsStore } from '../stores/sessions'
import { WriteTerminalInput } from '../composables/useWails'
import { WindowMinimise, WindowToggleMaximise, WindowIsMaximised, ResetAndResizeWindow, WindowHide } from '../composables/useWails'
import { useEventStream } from '../composables/useEventStream'

const router = useRouter()
const sessions = useSessionsStore()
useEventStream()

const showNew = ref(false)
const username = ref('')
const version = ref('0.1.0')
const isMaximized = ref(false)
const timelineCollapsed = ref(false)
type OpenedTerminal = { id: string; workdir: string }
const openedTerminals = ref<OpenedTerminal[]>([])

watch(() => [sessions.activeId, sessions.list.length], () => {
  const id = sessions.activeId
  const meta = sessions.list.find((s) => s.id === id)
  if (meta && !openedTerminals.value.some((s) => s.id === id)) {
    openedTerminals.value = [...openedTerminals.value, { id: meta.id, workdir: meta.workdir }]
  }
}, { immediate: true })

let maximizePollTimer: number | null = null

onMounted(async () => {
  await sessions.refresh()
  try {
    username.value = await (window as any).go?.app?.App?.OSUsername?.() ?? ''
  } catch {}
  try {
    await ResetAndResizeWindow(1280, 800, 1024, 680)
  } catch {}
  const syncMax = async () => {
    try { isMaximized.value = await WindowIsMaximised() } catch {}
  }
  void syncMax()
  maximizePollTimer = window.setInterval(syncMax, 500)
})

onBeforeUnmount(() => {
  if (maximizePollTimer) clearInterval(maximizePollTimer)
})

const state = computed(() => sessions.activeId ? (sessions.state[sessions.activeId] || 'idle') : 'idle')
const displayName = computed(() => sessions.active?.first_prompt || '新会话')

const permissionToastName = computed(() => {
  if (!sessions.activeId) return ''
  const req = sessions.hookPermissions[sessions.activeId]
  return req?.toolName || ''
})

async function onTerminalData(sessionId: string, data: string) {
  try {
    await WriteTerminalInput(sessionId, data)
  } catch (e: any) {
    console.error('[terminal] write failed:', e?.message)
  }
}

async function onCreate(workdir: string, prompt: string) {
  try {
    await sessions.create(workdir, prompt)
    showNew.value = false
  } catch (e: any) {
    alert('创建失败：' + (e?.message ?? e))
  }
}

function navigateToSession(sessionId: string) {
  sessions.select(sessionId)
}

function goSettings() { router.push('/settings') }
function onMinimize()  { WindowMinimise() }
async function onMaximize()  { await toggleMaximize() }
async function onRestore()   { await toggleMaximize() }
async function toggleMaximize() {
  WindowToggleMaximise()
  await new Promise(r => setTimeout(r, 80))
  try { isMaximized.value = await WindowIsMaximised() } catch {}
}
function onClose()     { WindowHide() }
</script>

<style scoped>
.home { display: flex; flex-direction: column; height: 100vh; }
.layout { flex: 1; display: flex; min-height: 0; gap: 1px; background: var(--border); }
.left {
  width: 280px; display: flex; flex-direction: column;
  background: var(--bg-panel);
  box-shadow: var(--shadow-panel);
  min-height: 0; overflow: hidden;
  z-index: 1;
}
.right { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg-primary); }
.terminal-area { flex: 1; min-height: 0; overflow: hidden; background: #1e1e1e; }
.empty { flex: 1; display: flex; align-items: center; justify-content: center; }
.empty-text { color: var(--text-tertiary); font-size: 12px; }
</style>
