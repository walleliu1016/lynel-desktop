<template>
  <div class="home">
    <TitleBar @minimize="onMinimize" @maximize="onMaximize" @close="onClose" />
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
            :path="sessions.active.workdir"
            :state="state"
            @open-terminal="openTerminal"
          />
          <div class="messages" ref="msgContainer">
            <MessageBubble v-for="m in messages" :key="m.id" :role="m.role" :content="m.content" />
            <ToolUseBlock v-for="(t, i) in toolBlocks" :key="i" :name="t.name" :args="t.args" />
            <PermissionPanel v-if="pending" :tool="pending.tool" :args="pending.args" @respond="respondPermission" />
            <div v-if="isStreaming" class="streaming">
              <span class="dot" /><span class="dot" /><span class="dot" />
            </div>
          </div>
          <Composer :disabled="state === 'awaiting_permission'" @send="onSend" />
        </template>
        <div v-else class="empty">
          <div class="empty-text">选择左侧会话，或点击 + 创建新会话</div>
        </div>
      </main>
    </div>
    <NewSessionDialog
      :open="showNew"
      @close="showNew = false"
      @create="onCreate"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import SessionList from '../components/SessionList.vue'
import UserBar from '../components/UserBar.vue'
import ToolBar from '../components/ToolBar.vue'
import MessageBubble from '../components/MessageBubble.vue'
import ToolUseBlock from '../components/ToolUseBlock.vue'
import PermissionPanel from '../components/PermissionPanel.vue'
import Composer from '../components/Composer.vue'
import NewSessionDialog from '../components/NewSessionDialog.vue'
import { useSessionsStore } from '../stores/sessions'
import { WindowMinimise, WindowToggleMaximise, WindowQuit, OpenInTerminal, RespondPermission } from '../composables/useWails'
import { useEventStream } from '../composables/useEventStream'

const router = useRouter()
const sessions = useSessionsStore()
useEventStream()

const showNew = ref(false)
const pending = ref<{ tool: string; args: unknown; reqId: string } | null>(null)
const toolBlocks = ref<Array<{ name: string; args: unknown }>>([])
const username = ref('')
const version = ref('0.1.0')
const msgContainer = ref<HTMLElement | null>(null)

onMounted(async () => {
  await sessions.refresh()
  try {
    username.value = await (window as any).go?.app?.App?.OSUsername?.() ?? ''
  } catch {}
})

const messages = computed(() => sessions.activeId ? sessions.messages[sessions.activeId] ?? [] : [])
const isStreaming = computed(() => sessions.activeId ? sessions.streaming[sessions.activeId] : false)
const state = computed<'idle' | 'running' | 'awaiting_permission'>(() => 'idle')
const displayName = computed(() => sessions.active?.first_prompt || '新会话')

async function onSend(text: string) {
  if (!sessions.activeId) return
  await sessions.send(sessions.activeId, text)
  await nextTick()
  scrollToBottom()
}

function scrollToBottom() {
  if (msgContainer.value) msgContainer.value.scrollTop = msgContainer.value.scrollHeight
}

async function onCreate(workdir: string, prompt: string) {
  try {
    await sessions.create(workdir, prompt)
  } catch (e: any) {
    alert('创建失败：' + (e?.message ?? e))
  }
}

async function openTerminal() {
  if (!sessions.active) return
  try {
    await OpenInTerminal(sessions.active.workdir, sessions.active.id, '')
  } catch (e: any) {
    alert('打开终端失败：' + (e?.message ?? e))
  }
}

async function respondPermission(allow: boolean) {
  if (!pending.value || !sessions.activeId) return
  try {
    await RespondPermission(sessions.activeId, pending.value.reqId, allow)
    pending.value = null
  } catch (e: any) {
    alert('响应失败：' + (e?.message ?? e))
  }
}

function goSettings() { router.push('/settings') }
function onMinimize()  { WindowMinimise() }
function onMaximize()  { WindowToggleMaximise() }
function onClose()     { WindowQuit() }
</script>

<style scoped>
.home { display: flex; flex-direction: column; height: 100vh; }
.layout { flex: 1; display: flex; min-height: 0; }
.left {
  width: 280px; display: flex; flex-direction: column;
  background: var(--bg-panel); border-right: 1px solid var(--border);
}
.right { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.messages { flex: 1; overflow-y: auto; padding: 12px 16px; }
.empty { flex: 1; display: flex; align-items: center; justify-content: center; }
.empty-text { color: var(--text-tertiary); font-size: 12px; }
.streaming { display: flex; gap: 4px; padding: 8px 0; }
.streaming .dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}
.streaming .dot:nth-child(2) { animation-delay: 0.2s; }
.streaming .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes pulse { 0%, 100% { opacity: 0.3 } 50% { opacity: 1 } }
</style>
