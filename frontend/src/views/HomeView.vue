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
            :ai-title="sessions.active?.ai_title"
            :path="sessions.active.workdir"
            :session-id="sessions.active.id"
            :msg-count="sessions.active.msg_count"
            :state="state"
            :owner="owner"
            :terminal-loading="terminalLoading"
            :switching-to-app="switchingToApp"
            @open-terminal="openTerminal"
            @takeback="takeback"
          />
          <div class="messages" ref="msgContainer" @scroll="onScroll">
            <MessageCard
              v-for="m in displayMessages"
              :key="m.id"
              :role="m.displayRole"
              :blocks="m.blocks"
              :ts="m.ts"
            />
            <PermissionPanel v-if="pending" :tool="pending.tool" :args="pending.args" @respond="respondPermission" />
            <div v-if="isStreaming" class="streaming">
              <span class="dot" /><span class="dot" /><span class="dot" />
            </div>
          </div>
          <Composer
            :disabled="state === 'awaiting_permission'"
            :terminal-mode="isTerminalMode"
            @send="onSend"
          />
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
import { onMounted, ref, computed, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import SessionList from '../components/SessionList.vue'
import UserBar from '../components/UserBar.vue'
import ToolBar from '../components/ToolBar.vue'
import MessageCard from '../components/MessageCard.vue'
import PermissionPanel from '../components/PermissionPanel.vue'
import Composer from '../components/Composer.vue'
import NewSessionDialog from '../components/NewSessionDialog.vue'
import { useSessionsStore } from '../stores/sessions'
import { WindowMinimise, WindowToggleMaximise, WindowQuit, OpenInTerminal, RespondPermission, SwitchOwner } from '../composables/useWails'
import { useEventStream } from '../composables/useEventStream'

const router = useRouter()
const sessions = useSessionsStore()
useEventStream()

const showNew = ref(false)
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
// tool-reply 角色检测：user 消息里只有 tool_result block 时，UI 渲染为「工具回复」卡（黄底）
// 与参考实现保持一致。
const displayMessages = computed(() => messages.value.map((m) => {
  const isAllToolResult = m.blocks.length > 0 && m.blocks.every((b) => b.type === 'tool_result')
  let displayRole: 'user' | 'assistant' | 'tool-reply'
  if (m.role === 'user' && isAllToolResult) displayRole = 'tool-reply'
  else if (m.role === 'user' || m.role === 'assistant') displayRole = m.role
  else displayRole = 'assistant' // 旧 jsonl 的 'tool' role 降级
  return { ...m, displayRole }
}))
const isStreaming = computed(() => sessions.activeId ? sessions.streaming[sessions.activeId] : false)
const state = computed(() => sessions.activeId ? (sessions.state[sessions.activeId] || 'idle') : 'idle')
const pending = computed(() => sessions.activeId ? (sessions.pending[sessions.activeId] || null) : null)
const displayName = computed(() => sessions.active?.first_prompt || '新会话')
// 'app' 默认；'terminal' 表示外部 claude -r 持 stdin（ToolBar 渲染"切回"按钮）
const owner = computed<'app' | 'terminal'>(() =>
  sessions.activeId ? (sessions.owner[sessions.activeId] ?? 'app') : 'app'
)
const isTerminalMode = computed(() => owner.value === 'terminal')
const terminalLoading = computed(() =>
  sessions.activeId ? (sessions.terminalLoading[sessions.activeId] ?? false) : false
)
const switchingToApp = computed(() =>
  sessions.activeId ? (sessions.switchingToApp[sessions.activeId] ?? false) : false
)

// 切换会话或新消息到达时，滚动到底部
watch(messages, () => { nextTick(() => scrollToBottom()) })

async function onSend(text: string) {
  if (!sessions.activeId) return
  try {
    await sessions.send(sessions.activeId, text)
  } catch (e: any) {
    alert('发送失败：' + (e?.message ?? e))
    return
  }
  await nextTick()
  scrollToBottom()
}

function scrollToBottom() {
  if (msgContainer.value) msgContainer.value.scrollTop = msgContainer.value.scrollHeight
}

function onScroll() {
  const el = msgContainer.value
  if (!el) return
  // 滚动到顶部时加载更多
  if (el.scrollTop <= 10 && sessions.hasMore[sessions.activeId || '']) {
    sessions.loadMore()
  }
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
  const sid = sessions.active.id
  sessions.terminalLoading = { ...sessions.terminalLoading, [sid]: true }
  try {
    await OpenInTerminal(sessions.active.workdir, sid, '')
    // 不乐观更新 owner；等外部 claude 启动后 SessionStart hook 会把它改成 terminal
    setTimeout(() => {
      if (sessions.terminalLoading[sid]) {
        sessions.terminalLoading = { ...sessions.terminalLoading, [sid]: false }
        alert('终端启动超时，未收到 SessionStart 事件')
      }
    }, 15000)
  } catch (e: any) {
    sessions.terminalLoading = { ...sessions.terminalLoading, [sid]: false }
    alert('打开终端失败：' + (e?.message ?? e))
  }
}

// 主动切回 App 控制（不发送新 prompt）：kill 外部 claude + 启 stream-json 进程
async function takeback() {
  if (!sessions.activeId) return
  const sid = sessions.activeId
  sessions.switchingToApp = { ...sessions.switchingToApp, [sid]: true }
  try {
    await SwitchOwner(sid, 'app', '')
    sessions.owner = { ...sessions.owner, [sid]: 'app' }
    sessions.mode  = { ...sessions.mode,  [sid]: 'stream' }
  } catch (e: any) {
    alert('切回 App 控制失败：' + (e?.message ?? e))
  } finally {
    sessions.switchingToApp = { ...sessions.switchingToApp, [sid]: false }
  }
}

async function respondPermission(allow: boolean) {
  if (!pending.value || !sessions.activeId) return
  try {
    await RespondPermission(sessions.activeId, pending.value.reqId, allow)
    sessions.pending[sessions.activeId] = null
    sessions.state[sessions.activeId] = 'running'
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
  min-height: 0; overflow: hidden;
}
.right { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
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
