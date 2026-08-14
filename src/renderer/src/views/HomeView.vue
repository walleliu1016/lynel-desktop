<template>
  <div class="home">
    <div class="layout">
      <aside class="left" :class="{ collapsed: sidebarCollapsed }">
        <div class="left-top" :class="{ mac: isMac, win: isWindows, collapsed: sidebarCollapsed }">
          <template v-if="!sidebarCollapsed">
            <span v-if="!isMac" class="brand-inline" aria-hidden="true">Lynel Desktop</span>
            <button class="top-btn tooltip-wrap" :aria-label="sidebarCollapsed ? '展开会话列表' : '收起会话列表'" @click="sidebarCollapsed = !sidebarCollapsed">
              <Icon :name="sidebarCollapsed ? 'arrow-right-from-line' : 'arrow-left-to-line'" :size="16" />
              <span class="tooltip-down">{{ sidebarCollapsed ? '展开会话列表' : '收起会话列表' }}</span>
            </button>
            <div v-if="cloudEnabled" class="cloud-status" :class="cloudStatusClass" :title="cloudStatusTitle">
              <span class="dot" />
              <span class="label">{{ cloudStatusText }}</span>
            </div>
          </template>
        </div>
        <div v-if="isMac && !sidebarCollapsed" class="left-brand-area">
          <span class="brand-title">Lynel Desktop</span>
          <span class="brand-version">(v{{ version }})</span>
        </div>
        <!-- 会话列表上方：首页入口（全宽） -->
        <button v-if="!sidebarCollapsed" class="home-entry" :class="{ active: tabsStore.activeType === 'welcome' }" aria-label="首页" title="首页" @click="tabsStore.openWelcome()">
          <Icon name="home" :size="16" />
          <span>首页</span>
        </button>
        <template v-if="!sidebarCollapsed">
          <button v-if="!searchOpen" class="home-entry search-entry" aria-label="搜索" title="搜索" @click="openSearch">
            <Icon name="search" :size="16" />
            <span>搜索</span>
          </button>
          <div v-else class="search-inplace">
            <Icon name="search" :size="13" class="search-box-icon" />
            <input
              ref="searchInputEl"
              v-model="searchQuery"
              class="search-inplace-input"
              placeholder="搜索…"
              @keydown.escape="closeSearch"
              @blur="closeSearch"
            />
            <button v-if="searchQuery" class="search-box-clear" aria-label="清除搜索" title="清除搜索" @mousedown.prevent="searchQuery = ''">
              <Icon name="close" :size="12" />
            </button>
          </div>
        </template>
        <SessionList
          :list="sessions.list"
          :active-id="activeSessionId"
          :collapsed="sidebarCollapsed"
          :search="searchQuery"
          @select="onSelectSession"
        >
          <template #actions>
            <button class="head-action tooltip-wrap" aria-label="打开 Session" @click="showNewSession = true">
              <Icon name="folder-open" :size="13" />
              <span class="tooltip-down">打开 Session</span>
            </button>
          </template>
        </SessionList>
        <div v-if="!sidebarCollapsed" class="left-bottom">
          <div class="bottom-actions">
            <div v-if="username" class="account">
              <span class="avatar" aria-hidden="true">{{ avatar }}</span>
              <div class="info">
                <b>{{ username }}</b>
                <span>本地</span>
              </div>
              <button class="logout-btn" aria-label="退出登录" title="退出登录" @click="onLogout">
                <Icon name="log-out" :size="11" />
              </button>
            </div>
            <div class="bottom-right">
              <button class="top-btn tooltip-wrap" aria-label="使用指南" @click="openGuideTab">
                <Icon name="help" :size="13" />
                <span class="tooltip">使用指南</span>
              </button>
              <button class="top-btn tooltip-wrap" aria-label="设置" @click="openSettingsTab()">
                <Icon name="settings" :size="13" />
                <span class="tooltip">设置</span>
              </button>
            </div>
          </div>
        </div>
      </aside>
      <div class="center">
        <div class="center-top" :class="{ 'mac-left': isMac && sidebarCollapsed, win: isWindows }">
          <button
            v-if="sidebarCollapsed"
            class="top-btn tooltip-wrap"
            aria-label="展开会话列表"
            @click="sidebarCollapsed = false"
          >
            <Icon name="arrow-right-from-line" :size="16" />
            <span class="tooltip-down">展开会话列表</span>
          </button>
          <GlobalTabs
            class="center-tabs"
            :tabs="tabsStore.tabs"
            :active-id="tabsStore.activeId"
            :hide-new="isWindows"
            @select="onSelectTab"
            @close="onCloseTab"
            @create="onCreateTab"
          />
          <button
            v-if="activeSessionId && traceCollapsed"
            class="top-btn tooltip-wrap"
            aria-label="展开 Trace"
            @click="traceCollapsed = false"
          >
            <Icon name="panel-right-open" :size="16" />
            <span class="tooltip-down">展开 Trace</span>
          </button>
        </div>
        <div class="content">
          <div v-show="tabsStore.activeType === 'welcome'" class="content-pane">
            <WelcomeTab
              @create="onCreateFromHome"
              @open-recent="onOpenRecent"
            />
          </div>
          <div v-show="tabsStore.activeType === 'session'" class="content-pane session-content">
            <template v-if="sessionTabs.length > 0">
              <SessionTabContent
                v-for="tab in sessionTabs"
                :key="tab.payload?.sessionId as string"
                v-show="activeSessionId === tab.payload?.sessionId"
                :session-id="tab.payload?.sessionId as string"
                :workdir="tab.payload?.workdir as string"
                :visible="activeSessionId === tab.payload?.sessionId"
              />
            </template>
            <div v-else class="empty"><div class="empty-text">未选择会话</div></div>
            <!-- Trace overlay (only when session active and overlay open) -->
            <TraceOverlay
              v-if="activeSessionId && showTraceOverlay"
              @close="closeTraceOverlay"
            />
          </div>
          <div v-show="tabsStore.activeType === 'settings'" class="content-pane">
            <SettingsTab :active="settingsActiveTab" @update:active="settingsActiveTab = $event" />
          </div>
          <div v-show="tabsStore.activeType === 'guide'" class="content-pane">
            <GuideTab />
          </div>
        </div>
      </div>
      <!-- Right sidebar: visible only when session is active -->
      <TraceSidebar
        v-if="activeSessionId"
        :collapsed="traceCollapsed"
        @select="onTraceSelect"
        @toggle-collapse="traceCollapsed = !traceCollapsed"
      />
    </div>
    <NewSessionDialog
      :open="showNewSession"
      :loading="sessions.creating"
      @close="showNewSession = false"
      @create="onCreateFromSession"
      @open-recent="onOpenRecent"
    />
    <CloseSessionDialog
      :open="showCloseDialog"
      :session-title="pendingCloseTitle"
      @confirm="onConfirmCloseSession"
      @cancel="onCancelCloseSession"
    />
    <div v-if="!isMac" class="win-controls">
      <button class="win-btn" aria-label="最小化" title="最小化" @click="minimize">
        <Icon name="minimize" :size="12" />
      </button>
      <button class="win-btn" :aria-label="isMaximized ? '还原' : '最大化'" :title="isMaximized ? '还原' : '最大化'" @click="toggleMaximize">
        <Icon :name="isMaximized ? 'restore' : 'maximize'" :size="12" />
      </button>
      <button class="win-btn close" aria-label="隐藏到托盘" title="隐藏到托盘" @click="hide">
        <Icon name="close" :size="12" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import GlobalTabs from '../components/GlobalTabs.vue'
import SessionList from '../components/SessionList.vue'
import TraceSidebar from '../components/trace/TraceSidebar.vue'
import TraceOverlay from '../components/trace/TraceOverlay.vue'
import WelcomeTab from '../components/WelcomeTab.vue'
import SessionTabContent from '../components/SessionTabContent.vue'
import SettingsTab from '../components/SettingsTab.vue'
import GuideTab from '../components/GuideTab.vue'
import NewSessionDialog from '../components/NewSessionDialog.vue'
import CloseSessionDialog from '../components/CloseSessionDialog.vue'
import { useSessionsStore, sessionDisplayTitle } from '../stores/sessions'
import { useTabsStore } from '../stores/tabs'
import { useTraceStore } from '../stores/trace'
import type { RecentSession } from '../types/recent'
import type { SessionState } from '../types/session'
import { GetAppInfo, AdoptSession, OpenSessionTerminal, CloseSession, Logout, CloudConnectionState, GetSettings } from '../composables/useElectron'
import { EventsOn, GetUpdateStatus } from '../composables/useElectron'
import { useWindowState } from '../composables/useWindowState'
import { pushToast } from '../composables/useToast'
import { useEventStream } from '../composables/useEventStream'
import { useAuthStore } from '../stores/auth'
import type { Tab as SettingsTabKey } from '../components/SettingsTabs.vue'

const router = useRouter()
const auth = useAuthStore()
const sessions = useSessionsStore()
const tabsStore = useTabsStore()
const trace = useTraceStore()
useEventStream()

const showNewSession = ref(false)
const username = ref('')
const version = ref('')
const sidebarCollapsed = ref(false)
const traceCollapsed = ref(false)
const showTraceOverlay = ref(false)
const settingsActiveTab = ref<SettingsTabKey>('general')
const showCloseDialog = ref(false)
const pendingCloseTabId = ref<string | null>(null)
const pendingCloseTitle = ref('')
let updateCleanup: (() => void) | null = null
let startupUpdateShown = false

// 会话搜索：顶栏搜索图标点击展开输入框
const searchOpen = ref(false)
const searchQuery = ref('')
const searchInputEl = ref<HTMLInputElement | null>(null)
// 会话列表底部操作区（设置/指南/账户/退出，横向并列）

function openSearch() {
  searchOpen.value = true
  nextTick(() => searchInputEl.value?.focus())
}

function closeSearch() {
  searchOpen.value = false
  searchQuery.value = ''
}

const { isMaximized, minimize, toggleMaximize, hide } = useWindowState()
const isMac = computed(() => navigator.platform.toLowerCase().includes('mac'))
const isWindows = computed(() => navigator.platform.toLowerCase().includes('win'))
const avatar = computed(() => (username.value || '').slice(0, 2).toUpperCase() || 'U')

// 云服务连接状态：仅 cloud_service_enabled 时显示（位于左侧顶栏）
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
    case 'connected':
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

const activeTab = computed(() => tabsStore.activeTab)
const activeSessionId = computed(() => {
  if (activeTab.value?.type !== 'session') return null
  return (activeTab.value.payload?.sessionId as string) ?? null
})
const activeSessionWorkdir = computed(() => {
  if (activeTab.value?.type !== 'session') return ''
  return (activeTab.value.payload?.workdir as string) ?? ''
})
const sessionTabs = computed(() => tabsStore.tabs.filter((t) => t.type === 'session'))
// 移除 traceTabs、activeTraceId

// 切 session 时关闭 overlay 并加载 trace 数据。
// 去掉 newId === trace.sessionId 的早退：即使切回已加载过的会话也重新拉取，
// 保证 resume / 重开后右侧 trace 始终是最新数据。
watch(activeSessionId, (newId) => {
  showTraceOverlay.value = false
  if (!newId) return
  const wd = activeSessionWorkdir.value
  if (!wd) return
  trace.setSession(wd, newId)
  trace.load()
})

onMounted(async () => {
  try {
    const info = await GetAppInfo()
    username.value = info.username
    version.value = info.version
  } catch {}

  try {
    const status = await GetUpdateStatus()
    maybeShowStartupUpdate(status)
  } catch {}

  updateCleanup = EventsOn('update:state', (s: any) => {
    maybeShowStartupUpdate(s)
  })

  try {
    const cfg = await GetSettings()
    cloudEnabled.value = !!cfg.cloud_service_enabled
  } catch {}
  if (cloudEnabled.value) {
    refreshCloudState()
    cloudPollTimer = setInterval(refreshCloudState, 2000)
  }
})

onBeforeUnmount(() => {
  updateCleanup?.()
  if (cloudPollTimer) {
    clearInterval(cloudPollTimer)
    cloudPollTimer = null
  }
})

function onSelectTab(id: string) {
  tabsStore.activate(id)
}

function onCreateTab() {
  tabsStore.openWelcome()
}

function isRunningState(state: SessionState) {
  return (
    state === 'waiting' ||
    state === 'thinking' ||
    state === 'streaming' ||
    state === 'running_tool' ||
    state === 'awaiting_permission'
  )
}

async function onCloseTab(id: string) {
  const tab = tabsStore.tabs.find((t) => t.id === id)
  if (!tab) return

  if (tab.type === 'session') {
    const sid = tab.payload?.sessionId as string
    const state = sessions.state[sid] || 'idle'
    if (isRunningState(state)) {
      pendingCloseTabId.value = id
      pendingCloseTitle.value = tab.title || sid.slice(0, 8)
      showCloseDialog.value = true
      return
    }
    await closeSessionTab(id, sid)
    return
  }

  tabsStore.close(id)
  showTraceOverlay.value = false
}

async function closeSessionTab(id: string, sid: string) {
  try {
    await CloseSession(sid)
  } catch (e: any) {
    console.error('[home] close session failed:', e?.message || e)
  }
  sessions.remove(sid)
  tabsStore.close(id)
  showTraceOverlay.value = false
}

function onConfirmCloseSession() {
  const id = pendingCloseTabId.value
  if (!id) return
  const tab = tabsStore.tabs.find((t) => t.id === id)
  if (tab?.type === 'session') {
    void closeSessionTab(id, tab.payload?.sessionId as string)
  }
  showCloseDialog.value = false
  pendingCloseTabId.value = null
}

function onCancelCloseSession() {
  showCloseDialog.value = false
  pendingCloseTabId.value = null
}

async function onSelectSession(id: string) {
  const meta = sessions.list.find((s) => s.id === id)
  if (!meta) return
  // 重复点击当前已激活的会话：activeSessionId 不变化，下方 watch 不会触发，需强制刷新 trace
  const wasActive = activeSessionId.value === id
  tabsStore.openSession(id, meta.workdir, sessionDisplayTitle(meta))
  await sessions.select(id)
  if (wasActive && meta.workdir) {
    trace.setSession(meta.workdir, id)
    trace.load()
  }
  // 非 wasActive 时 trace 加载由 activeSessionId watch 统一处理
}

function closeTraceOverlay() {
  showTraceOverlay.value = false
}

function onTraceSelect(seq: number) {
  if (showTraceOverlay.value && trace.selectedSeq === seq) {
    // 点击已选中的行 → 关闭
    showTraceOverlay.value = false
  } else {
    trace.select(seq)
    showTraceOverlay.value = true
  }
}

async function onCreate(workdir: string, prompt: string, extraArgs: string[] = [], botId?: string, agent?: string) {
  try {
    const id = await sessions.create(workdir, prompt, extraArgs, botId, agent)
    const meta = sessions.list.find((s) => s.id === id)
    if (meta) {
      tabsStore.openSession(id, meta.workdir, sessionDisplayTitle(meta) || prompt)
    }
  } catch (e: any) {
    pushToast({ level: 'error', source: 'session', message: '创建失败：' + (e?.message ?? e) })
  }
}

async function onCreateFromHome(workdir: string, prompt: string, extraArgs: string[] = [], botId?: string, agent?: string) {
  await onCreate(workdir, prompt, extraArgs, botId, agent)
}

async function onCreateFromSession(workdir: string, prompt: string, extraArgs: string[] = [], botId?: string, agent?: string) {
  await onCreate(workdir, prompt, extraArgs, botId, agent)
  showNewSession.value = false
}

async function onOpenRecent(item: RecentSession) {
  // 先关弹窗立即进入主界面，再后台启动 PTY/代理（避免等待异步完成才消失）
  showNewSession.value = false
  try {
    // 重复打开当前已激活的会话：activeSessionId 不变化，需强制刷新 trace
    const wasActive = activeSessionId.value === item.sessionId
    sessions.open(item)
    tabsStore.openSession(item.sessionId, item.workdir, sessionDisplayTitle({
      id: item.sessionId,
      user_title: item.userTitle,
      ai_title: item.aiTitle,
      first_prompt: item.firstPrompt,
    }))
    await AdoptSession(item.sessionId, item.workdir)
    await OpenSessionTerminal(item.sessionId, item.workdir)
    // 加载 bot 绑定信息
    await sessions.loadBotNames()
    if (item.botId) {
      sessions.sessionBots = { ...sessions.sessionBots, [item.sessionId]: item.botId }
    }
    if (wasActive && item.workdir) {
      trace.setSession(item.workdir, item.sessionId)
      trace.load()
    }
  } catch (e: any) {
    console.error('[home] open recent failed:', e?.message || e)
    pushToast({ level: 'error', source: 'session', message: '打开最近会话失败：' + (e?.message || e) })
  }
}

function openSettingsTab(tab: SettingsTabKey = 'general') {
  settingsActiveTab.value = tab
  tabsStore.openSettings()
}

function openGuideTab() {
  tabsStore.openGuide()
}

function maybeShowStartupUpdate(status: any) {
  if (status?.status !== 'available') return
  if (status?.data?.source !== 'startup') return
  if (startupUpdateShown) return
  try {
    if (sessionStorage.getItem('lynel-desktop:startup-update-toast-shown')) {
      startupUpdateShown = true
      return
    }
  } catch {}
  const version = status?.data?.version
  if (!version) return
  startupUpdateShown = true
  try {
    sessionStorage.setItem('lynel-desktop:startup-update-toast-shown', '1')
  } catch {}
  pushToast({
    level: 'info',
    source: '在线升级',
    message: `发现新版本 v${version}，点击前往 设置 → 在线升级 下载更新`,
    duration: 8000,
    onClick: () => openSettingsTab('updater'),
  })
}

async function onLogout() {
  try { await Logout() } catch {}
  auth.logout()
  sessions.reset()
  tabsStore.tabs = [{ id: 'welcome', type: 'welcome' as const, title: '首页' }]
  tabsStore.activeId = 'welcome'
  router.push('/login')
}

// 当 session 元信息加载后，同步更新对应 Tab 标题
watch(
  () => sessions.list.map((s) => `${s.id}:${s.user_title}:${s.ai_title}:${s.first_prompt}:${s.title_source}`).join('|'),
  () => {
    for (const s of sessions.list) {
      const tabId = `session-${s.id}`
      const tab = tabsStore.tabs.find((t) => t.id === tabId)
      if (tab) {
        const newTitle = sessionDisplayTitle(s)
        if (tab.title !== newTitle) {
          tab.title = newTitle
        }
      }
    }
  }
)
</script>

<style scoped>
.home { display: flex; flex-direction: column; height: 100vh; position: relative; }
/* 窗口控制按钮：固定在窗口最右上角，不随三列布局位置变化 */
.win-controls {
  position: absolute;
  top: 9px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 2px;
  z-index: 50;
  -webkit-app-region: no-drag;
}

/* 三段式布局：各列顶部操作行高度统一，分割线从窗口顶部连贯 */
.left-top {
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 0 10px;
  background: var(--bg-panel);
  font-size: var(--fs-body-sm);
  box-sizing: border-box;
  position: relative;
  -webkit-app-region: drag;
  --wails-draggable: drag;
  user-select: none;
}
.left-brand-area {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: flex-start;
  gap: 6px;
  padding: 6px 0 0 16px;
  background: var(--bg-panel);
  flex-shrink: 0;
}
.brand-title {
  font-weight: 800;
  font-size: 16px;
  letter-spacing: -0.2px;
  color: var(--accent);
  background: var(--brand-grad);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.brand-version {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}
.left-top.win {
  justify-content: flex-start;
}
/* Windows 内联品牌字（无版本号），与左侧按钮同处一行；
   margin-right: auto 把右侧按钮组整体推到最右，避免 space-between 均匀铺开导致分散 */
.brand-inline {
  font-weight: 800;
  font-size: 14px;
  letter-spacing: -0.2px;
  white-space: nowrap;
  flex-shrink: 0;
  margin-right: auto;
  background: var(--brand-grad);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.left-top.collapsed {
  justify-content: center;
  padding: 0;
}
.left-top.collapsed .btn-open,
.left-top.collapsed .cloud-status {
  display: none;
}
/* macOS：红绿灯悬浮左上角，折叠后展开按钮绝对定位到红绿灯右侧 */
.left-top.mac.collapsed {
  justify-content: center;
  padding-left: 0;
}
.left-top.mac.collapsed .top-btn {
  position: absolute;
  left: 78px;
  top: 50%;
  transform: translateY(-50%);
}
/* 搜索按钮原位变为输入框 */
.search-inplace {
  display: flex; align-items: center; gap: 6px;
  margin: 0 10px 6px;
  height: 36px; padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-strong); border-radius: var(--radius-md);
}
.search-inplace:focus-within { border-color: var(--accent); }
.search-inplace-input {
  flex: 1; min-width: 0;
  border: none; outline: none; background: transparent;
  color: var(--text-primary); font-size: 13px; font-family: inherit;
}
.search-inplace-input::placeholder { color: var(--text-tertiary); }
/* 会话列表上方：首页入口（平铺导航项） */
.home-entry {
  display: flex; align-items: center; justify-content: flex-start; gap: 6px;
  padding: 0 12px;
  margin: 6px 8px 4px;
  height: 36px; flex-shrink: 0;
  border: none; border-radius: var(--radius-md);
  background: transparent; color: var(--text-secondary);
  font-size: var(--fs-body-sm); font-weight: 600; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  -webkit-app-region: no-drag;
}
.home-entry:hover { background: var(--bg-hover); color: var(--text-primary); }
.home-entry.active { color: var(--accent); }
.search-entry { margin-top: 0; }
/* 会话列表标题行右侧：打开/搜索 */
.head-action {
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--text-tertiary);
  border-radius: 5px; cursor: pointer; flex-shrink: 0;
  transition: color 0.12s, background 0.12s;
}
.head-action:hover { color: var(--text-primary); background: var(--bg-input); }
/* 「打开 Session」按钮位于标题行最右，tooltip 右对齐向左展开，
   避免向右超出左面板（overflow:hidden）被裁剪 */
.head-action .tooltip-down {
  left: auto;
  right: 0;
  transform: none;
}
.center-top {
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 2px;
  background: var(--bg-panel);
  font-size: var(--fs-body-sm);
  min-width: 0;
  -webkit-app-region: drag;
  --wails-draggable: drag;
  user-select: none;
}
.center-top :deep(.global-tabs) {
  height: 100%;
}
/* macOS 折叠会话列表时，红绿灯悬浮左侧（0-78px），内容区从 44px 开始，让内容从红绿灯右侧起排 */
.center-top.mac-left {
  padding-left: 92px;
}
/* Windows 无边框窗口右上角有自绘窗口控制按钮（约 82px）：
   1. center-top 右侧预留 96px 避让区，GlobalTabs 与"展开 Trace"按钮都在其内自然排列；
   2. 底边横线移到 center-top 上贯穿全宽（GlobalTabs 去掉自身横线），
      不随按钮挤压/折叠态断掉，实现自适应。 */
.center-top.win {
  padding-right: 96px;
  border-bottom: 1px solid var(--border-strong);
}
.center-top.win :deep(.global-tabs) {
  border-bottom: none;
}
.center-tabs {
  flex: 1;
  min-width: 0;
}
.top-btn {
  height: 26px;
  min-width: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 7px;
  -webkit-app-region: no-drag;
  transition: color 0.12s, background 0.12s;
}
.top-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.search-box-icon { color: var(--text-tertiary); flex-shrink: 0; }
.search-box-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
}
.search-box-input::placeholder { color: var(--text-tertiary); }
.search-box-clear {
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent;
  color: var(--text-tertiary); border-radius: 4px;
  cursor: pointer; flex-shrink: 0;
}
.search-box-clear:hover { color: var(--text-primary); background: var(--border); }
.cloud-status {
  display: flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 8px;
  border-radius: 16px; font-size: 10px; font-weight: 600;
  border: 1px solid var(--border);
  background: var(--bg-panel); color: var(--text-secondary);
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}
.cloud-status .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
.cloud-status.ok { border-color: color-mix(in srgb, var(--status-success) 30%, transparent); background: var(--status-success-soft); color: color-mix(in srgb, var(--status-success) 40%, var(--text-primary)); }
.cloud-status.ok .dot { background: var(--status-success); box-shadow: 0 0 6px color-mix(in srgb, var(--status-success) 50%, transparent); }
.cloud-status.fail { border-color: color-mix(in srgb, var(--status-error) 30%, transparent); background: var(--status-error-soft); color: color-mix(in srgb, var(--status-error) 40%, var(--text-primary)); }
.cloud-status.fail .dot { background: var(--status-error); }
.cloud-status.testing { border-color: color-mix(in srgb, var(--status-warn) 30%, transparent); background: var(--status-warn-soft); color: color-mix(in srgb, var(--status-warn) 40%, var(--text-primary)); }
.cloud-status.testing .dot { background: var(--status-warn); animation: cloud-pulse 0.8s infinite; }
@keyframes cloud-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.account {
  display: flex; align-items: center; gap: 8px;
  padding-left: 12px; border-left: 1px solid var(--border);
  -webkit-app-region: no-drag;
}
.avatar {
  width: 22px; height: 22px; border-radius: 7px;
  background: var(--accent); color: var(--text-inverse);
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-caption); font-weight: 800;
}
.info { display: flex; flex-direction: column; }
.info b { font-size: 10px; color: var(--text-primary); }
.info span { font-size: 9px; color: var(--text-tertiary); }
.logout-btn {
  width: 18px; height: 18px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
}
.logout-btn:hover { color: var(--status-error); background: var(--status-error-soft); }
.win-btns { display: flex; align-items: center; gap: 2px; -webkit-app-region: no-drag; }
.win-btn {
  width: 26px; height: 22px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.win-btn:hover { background: var(--bg-hover); }
.win-btn.close:hover { background: var(--status-error); color: var(--text-inverse); }
.left-bottom {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  -webkit-app-region: no-drag;
}
.bottom-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 10px;
  min-height: 40px;
}
.bottom-actions .account {
  padding-left: 0;
  border-left: none;
}
.bottom-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tooltip-wrap {
  position: relative;
}
.tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--tooltip-bg);
  color: var(--tooltip-color);
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 30;
}
.tooltip-wrap:hover .tooltip {
  opacity: 1;
}
.tooltip-down {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--tooltip-bg);
  color: var(--tooltip-color);
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 40;
}
.tooltip-wrap:hover .tooltip-down {
  opacity: 1;
}

.layout { flex: 1; display: flex; min-height: 0; gap: 0; background: transparent; }
.left {
  width: 280px; display: flex; flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  box-shadow: var(--shadow-panel);
  min-height: 0; overflow: hidden;
  z-index: 1;
  transition: width 0.2s ease;
}
.left.collapsed { width: 0; overflow: visible; }
.center {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  position: relative;
  background: var(--bg-primary);
}
.content { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; position: relative; }
.content-pane { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.empty { flex: 1; display: flex; align-items: center; justify-content: center; }
.empty-text { color: var(--text-tertiary); font-size: 12px; }
/* session content 需要 position: relative 给 overlay 定位 */
.session-content { position: relative; }
</style>
