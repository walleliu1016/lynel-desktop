<template>
  <div class="home" :class="{ 'is-mac': isMac }">
    <div class="layout">
      <aside class="left" :class="{ collapsed: sidebarCollapsed }">
        <div class="left-top" :class="{ mac: isMac, win: isWindows, collapsed: sidebarCollapsed }">
          <template v-if="!sidebarCollapsed">
            <span v-if="!isMac" class="brand-inline" aria-hidden="true">Lynel Desktop</span>
            <button class="top-btn tooltip-wrap" aria-label="收起侧边栏" @click="sidebarCollapsed = true">
              <Icon name="panel-left-close" :size="16" />
              <span class="tooltip-down">收起侧边栏</span>
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
        <!-- 会话列表上方：首页入口（全宽）；折叠态仅保留图标 -->
        <button class="home-entry tooltip-wrap" :class="{ active: tabsStore.activeType === 'welcome' }" aria-label="首页" @click="onCollapsedEntry(tabsStore.openWelcome)">
          <Icon name="home" :size="16" />
          <span class="entry-label">首页</span>
          <span class="tooltip">首页</span>
        </button>
        <!-- DeepSeek Harness 入口：首页下方、搜索上方 -->
        <button class="home-entry tooltip-wrap" :class="{ active: tabsStore.activeType === 'harness' }" aria-label="DeepSeek Harness" @click="onOpenHarness">
          <DeepSeekLogo :size="16" />
          <span class="entry-label">DeepSeek Harness</span>
          <span class="tooltip">DeepSeek Harness</span>
        </button>
        <button v-if="!sidebarCollapsed && !searchOpen" class="home-entry search-entry" aria-label="搜索" title="搜索" @click="openSearch">
          <Icon name="search" :size="16" />
          <span>搜索</span>
        </button>
        <div v-else-if="!sidebarCollapsed" class="search-inplace">
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
        <!-- 折叠态：搜索仅图标，点击展开侧栏并进入搜索 -->
        <button v-if="sidebarCollapsed" class="home-entry search-entry tooltip-wrap" aria-label="搜索" @click="onCollapsedSearch">
          <Icon name="search" :size="16" />
          <span class="tooltip">搜索</span>
        </button>
        <!-- 折叠态：会话列表仅图标，点击展开侧栏 -->
        <button v-if="sidebarCollapsed" class="home-entry session-collapsed-btn tooltip-wrap" aria-label="会话列表" @click="sidebarCollapsed = false">
          <Icon name="message-square" :size="16" />
          <span class="tooltip">会话列表</span>
        </button>
        <SessionList
          v-else
          :list="sessions.list"
          :active-id="activeSessionId"
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
        <div class="left-bottom" :class="{ collapsed: sidebarCollapsed }">
          <div v-if="!sidebarCollapsed" class="bottom-actions">
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
          <div v-else class="bottom-collapsed">
            <button class="top-btn tooltip-wrap" aria-label="使用指南" @click="openGuideTab">
              <Icon name="help" :size="16" />
              <span class="tooltip">使用指南</span>
            </button>
            <button class="top-btn tooltip-wrap" aria-label="设置" @click="openSettingsTab()">
              <Icon name="settings" :size="16" />
              <span class="tooltip">设置</span>
            </button>
          </div>
        </div>
      </aside>
      <div class="center">
        <div class="center-top" :class="{ 'mac-left': isMac && sidebarCollapsed, win: isWindows }">
          <GlobalTabs
            class="center-tabs"
            :tabs="tabsStore.tabs"
            :active-id="tabsStore.activeId"
            :hide-new="isWindows"
            @select="onSelectTab"
            @close="onCloseTab"
            @create="onCreateTab"
          />
          <!-- 展开 Workspace 按钮：暂时隐藏（Workspace 面板整体下线，后续恢复） -->
          <!--
          <button
            v-if="workspaceCollapsed"
            class="top-btn tooltip-wrap"
            aria-label="展开 Workspace"
            @click="workspaceCollapsed = false"
          >
            <Icon name="panel-right-open" :size="16" />
            <span class="tooltip-down">展开 Workspace</span>
          </button>
          -->
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
              <div class="sub-tabs">
                <button class="sub-tab" :class="{ active: activeSubTab === 'terminal' }" @click="setSubTab('terminal')">
                  <Icon name="terminal" :size="13" /> 终端
                </button>
                <button class="sub-tab" :class="{ active: activeSubTab === 'trace' }" @click="setSubTab('trace')">
                  <Icon name="activity" :size="13" /> Trace
                </button>
                <button class="sub-tab" :class="{ active: activeSubTab === 'code' }" @click="setSubTab('code')">
                  <Icon name="file-code" :size="13" /> 代码
                </button>
              </div>
              <div v-show="activeSubTab === 'terminal'" class="sub-pane">
                <SessionTabContent
                  v-for="tab in sessionTabs"
                  :key="tab.payload?.sessionId as string"
                  v-show="activeSessionId === tab.payload?.sessionId"
                  :session-id="tab.payload?.sessionId as string"
                  :workdir="tab.payload?.workdir as string"
                  :visible="activeSessionId === tab.payload?.sessionId"
                />
              </div>
              <div v-show="activeSubTab === 'trace'" class="sub-pane">
                <TracePane />
              </div>
              <div v-show="activeSubTab === 'code'" class="sub-pane">
                <CodeView />
              </div>
            </template>
            <div v-else class="empty"><div class="empty-text">未选择会话</div></div>
          </div>
          <div v-show="tabsStore.activeType === 'settings'" class="content-pane">
            <SettingsTab :active="settingsActiveTab" @update:active="settingsActiveTab = $event" />
          </div>
          <div v-show="tabsStore.activeType === 'guide'" class="content-pane">
            <GuideTab />
          </div>
          <!-- DeepSeek Harness：普通 tab pane -->
          <!-- DeepSeek Harness：iframe 始终挂载，非激活时 opacity:0 垫底。
               避免 Chromium 冻结 display:none 的跨源 iframe 导致切回时重新加载页面。 -->
          <div class="dsh-frame-wrap" :class="{ active: tabsStore.activeType === 'harness' }">
            <iframe
              v-if="harnessUrl"
              :src="harnessUrl"
              class="dsh-frame"
              allow="clipboard-read; clipboard-write"
            />
            <div v-if="harnessLoading" class="dsh-state">
              <Icon name="loader" :size="18" class="dsh-spinner" />
              <span>正在启动 DeepSeek Harness…</span>
            </div>
            <div v-else-if="harnessError" class="dsh-state">
              <Icon name="alert-circle" :size="18" />
              <span class="dsh-error-text">{{ harnessError }}</span>
              <button class="dsh-retry" @click="loadHarness">重试</button>
            </div>
          </div>
        </div>
      </div>
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
import DeepSeekLogo from '../components/DeepSeekLogo.vue'
import GlobalTabs from '../components/GlobalTabs.vue'
import SessionList from '../components/SessionList.vue'
import TracePane from '../components/trace/TracePane.vue'
import WorkspacePanel from '../components/WorkspacePanel.vue'
import CodeView from '../components/code/CodeView.vue'
import WelcomeTab from '../components/WelcomeTab.vue'
import SessionTabContent from '../components/SessionTabContent.vue'
import SettingsTab from '../components/SettingsTab.vue'
import GuideTab from '../components/GuideTab.vue'
import NewSessionDialog from '../components/NewSessionDialog.vue'
import CloseSessionDialog from '../components/CloseSessionDialog.vue'
import { useSessionsStore, sessionDisplayTitle } from '../stores/sessions'
import { useTabsStore } from '../stores/tabs'
import { useTraceStore } from '../stores/trace'
import { useFilesStore } from '../stores/files'
import type { RecentSession } from '../types/recent'
import type { SessionState } from '../types/session'
import { GetAppInfo, AdoptSession, OpenSessionTerminal, CloseSession, Logout, CloudConnectionState, GetSettings, DshEnsure } from '../composables/useElectron'
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
const files = useFilesStore()
useEventStream()

const showNewSession = ref(false)
const username = ref('')
const version = ref('')
const sidebarCollapsed = ref(false)
const workspaceCollapsed = ref(true)
// DeepSeek Harness tab：iframe 加载 harness 完整 UI
const harnessUrl = ref('')
const harnessLoading = ref(false)
const harnessError = ref('')
// 每个会话各自的 终端/Trace 选中态（按 sessionId 记录），切回会话时保留
const subTabBySession = ref<Record<string, 'terminal' | 'trace' | 'code'>>({})
const activeSubTab = computed<'terminal' | 'trace' | 'code'>(() => {
  const sid = activeSessionId.value
  return (sid && subTabBySession.value[sid]) || 'terminal'
})

function setSubTab(tab: 'terminal' | 'trace' | 'code') {
  const sid = activeSessionId.value
  if (!sid) return
  subTabBySession.value = { ...subTabBySession.value, [sid]: tab }
}
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

// 切 session 时加载 trace 数据。
// 去掉 newId === trace.sessionId 的早退：即使切回已加载过的会话也重新拉取，
// 保证 resume / 重开后 trace 始终是最新数据。
watch(activeSessionId, (newId) => {
  if (!newId) return
  const wd = activeSessionWorkdir.value
  if (!wd) return
  trace.setSession(wd, newId)
  trace.load()
  void files.setSession(newId, wd)
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
}

async function closeSessionTab(id: string, sid: string) {
  try {
    await CloseSession(sid)
  } catch (e: any) {
    console.error('[home] close session failed:', e?.message || e)
  }
  sessions.remove(sid)
  tabsStore.close(id)
  // 清理该会话的 sub-tab 选中记录
  if (subTabBySession.value[sid]) {
    const next = { ...subTabBySession.value }
    delete next[sid]
    subTabBySession.value = next
  }
  // 清理该会话的代码工作区现场
  files.forgetSession(sid)
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

/** 加载/启动 harness（幂等：已就绪则复用 URL，重试按钮复用）。 */
async function loadHarness() {
  if (harnessUrl.value) return
  harnessLoading.value = true
  harnessError.value = ''
  try {
    const res = await DshEnsure()
    harnessUrl.value = res.url
  } catch (e: any) {
    harnessError.value = e?.message ?? String(e)
  } finally {
    harnessLoading.value = false
  }
}

// 首次进入 harness tab 时加载 harness（不自动折叠左侧栏）
// 离开会话页时清理 files store（停止 watcher + 清空状态），避免残留影响终端性能
watch(
  () => tabsStore.activeType,
  (type) => {
    if (type === 'harness') void loadHarness()
    if (type !== 'session') void files.setSession('', '')
  },
)

// 折叠态点击搜索图标：先展开侧栏再进入搜索
function onCollapsedSearch() {
  sidebarCollapsed.value = false
  openSearch()
}

/** 收起态点击左侧导航图标（首页）：先展开侧栏再执行导航 */
function onCollapsedEntry(fn: () => void) {
  if (sidebarCollapsed.value) sidebarCollapsed.value = false
  fn()
}

/** 打开 Harness（全屏 Web）：自动折叠左侧栏，让出空间 */
function onOpenHarness() {
  tabsStore.openHarness()
  sidebarCollapsed.value = true
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
/* macOS 折叠会话列表时，红绿灯悬浮左侧（0-72px），内容区从红绿灯右侧起排 */
.center-top.mac-left {
  padding-left: 72px;
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
/* 收起态：底部只保留居中设置按钮 */
.left-bottom.collapsed {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
}
.bottom-collapsed {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
/* 收起态（窄侧栏）：tooltip 靠右弹出且置顶，避免上方放不下/被裁剪 */
.left.collapsed .tooltip {
  top: 50%;
  left: calc(100% + 8px);
  bottom: auto;
  transform: translateY(-50%);
  z-index: 100;
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
/* left-top 右侧按钮（收起侧边栏）的 tooltip：右对齐向左展开，避免超出左面板被 overflow:hidden 裁剪 */
.left-top .tooltip-down {
  left: auto;
  right: 0;
  transform: none;
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
  position: relative;
}
.left.collapsed { width: 44px; overflow: visible; }
/* macOS 折叠态：红绿灯悬浮左上角，去掉贯穿顶部的 border/shadow，竖线从红绿灯下方（left-top 40px）开始 */
.home.is-mac .left.collapsed {
  border-right: none !important;
  box-shadow: none !important;
}
.home.is-mac .left.collapsed::after {
  content: '';
  position: absolute;
  top: 40px;
  right: 0;
  bottom: 0;
  width: 1px;
  background: var(--border);
  pointer-events: none;
}
/* 折叠态：仅保留图标列，隐藏文字标签（保留 hover tooltip）、图标居中 */
.left.collapsed .home-entry {
  justify-content: center;
  padding: 0;
}
.left.collapsed .home-entry .entry-label { display: none; }
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
/* 会话视图内部：终端 / Trace 双 tab */
.sub-tabs {
  height: 34px; min-height: 34px;
  display: flex; align-items: center; gap: 4px;
  padding: 0 10px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  user-select: none;
}
.sub-tab {
  display: flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 14px;
  border: none; background: transparent;
  border-radius: var(--radius-sm);
  font-size: 12px; font-weight: 500; color: var(--text-secondary);
  cursor: pointer; font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
.sub-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
.sub-tab.active { background: var(--accent-soft-bg); color: var(--accent); font-weight: 600; }
.sub-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* DeepSeek Harness：iframe 始终挂载，非激活时透明垫底（不 display:none，避免冻结重载） */
.dsh-frame-wrap {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0;
  pointer-events: none;
  background: var(--bg-primary);
}
.dsh-frame-wrap.active {
  z-index: 20;
  opacity: 1;
  pointer-events: auto;
}
.dsh-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.dsh-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
  font-size: var(--fs-body-sm);
}
.dsh-spinner { animation: dsh-spin 1s linear infinite; }
@keyframes dsh-spin { to { transform: rotate(360deg); } }
/* reset.css 在系统「减少动态效果」时会把所有动画压成 0.01ms/1 次，
   loading 转圈是状态反馈动画，仍需保持旋转，故在此豁免 */
@media (prefers-reduced-motion: reduce) {
  .dsh-spinner {
    animation: dsh-spin 1s linear infinite !important;
  }
}
.dsh-error-text { color: var(--status-error); max-width: 420px; text-align: center; line-height: 1.5; }
.dsh-retry {
  padding: 6px 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.dsh-retry:hover { border-color: var(--accent); color: var(--accent); }
</style>
