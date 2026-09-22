<template>
  <div class="home" :class="{ 'is-mac': isMac }">
    <div class="layout">
      <aside class="left" :class="{ collapsed: sidebarCollapsed }">
        <div class="left-top" :class="{ mac: isMac, win: isWindows, collapsed: sidebarCollapsed }">
          <template v-if="!sidebarCollapsed">
            <span v-if="!isMac" class="brand-inline" aria-hidden="true">Lynel Desktop</span>
            <div v-if="cloudEnabled" class="cloud-status" :class="cloudStatusClass" :title="cloudStatusTitle">
              <span class="dot" />
              <span class="label">{{ cloudStatusText }}</span>
            </div>
            <button class="top-btn tooltip-wrap" aria-label="收起侧边栏" @click="sidebarCollapsed = true">
              <Icon name="panel-left-close" :size="16" />
              <span class="tooltip-down">收起侧边栏</span>
            </button>
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
        <!-- 任务入口：定时任务面板（独立全屏 tab） -->
        <button v-if="!sidebarCollapsed" class="home-entry tooltip-wrap" :class="{ active: tabsStore.activeType === 'tasks' }" aria-label="任务" @click="openTasksTab">
          <Icon name="alarm-clock" :size="16" />
          <span class="entry-label">任务</span>
          <span class="tooltip">任务</span>
        </button>
        <!-- 收藏夹入口：点击在下方展开收藏区（独立于会话列表） -->
        <button v-if="!sidebarCollapsed" class="home-entry tooltip-wrap" :class="{ active: favListOpen }" aria-label="收藏夹" @click="onToggleFavList">
          <Icon name="star" :size="16" :fill="favListOpen" />
          <span class="entry-label">收藏夹</span>
          <span class="tooltip">收藏夹</span>
        </button>
        <!-- 收藏夹展开区：仅展示收藏行（导航上已有「收藏夹」入口，故此处不再重复标题）；
             收起方式：再点「收藏夹」或点其它导航 -->
        <div v-if="!sidebarCollapsed && favListOpen" class="fav-pane">
          <div v-if="favorites.favorites.length" class="fav-pane-items">
            <div
              v-for="f in favorites.favorites"
              :key="f.sessionId"
              class="fav-pane-row"
              :class="{ active: f.sessionId === activeSessionId }"
              :title="favTitle(f)"
              @click="onOpenFavorite(f.sessionId)"
            >
              <AgentBadge :agent="f.agent" size="sm" />
              <span class="fav-pane-text">{{ favTitle(f) }}</span>
              <button class="fav-pane-del" title="取消收藏" @click.stop="onRemoveFav(f.sessionId)">
                <Icon name="star" :size="12" :fill="true" />
              </button>
            </div>
          </div>
          <div v-else class="fav-pane-empty">暂无收藏，可 hover 会话行星标收藏</div>
        </div>
        <!-- 折叠态：搜索仅图标，点击展开侧栏并进入搜索 -->
        <button v-if="sidebarCollapsed" class="home-entry search-entry tooltip-wrap" aria-label="搜索" @click="onCollapsedSearch">
          <Icon name="search" :size="16" />
          <span class="tooltip">搜索</span>
        </button>
        <!-- 折叠态：任务仅图标，点击展开侧栏再打开任务 tab -->
        <button v-if="sidebarCollapsed" class="home-entry tooltip-wrap" :class="{ active: tabsStore.activeType === 'tasks' }" aria-label="任务" @click="onCollapsedTasks">
          <Icon name="alarm-clock" :size="16" />
          <span class="tooltip">任务</span>
        </button>
        <!-- 折叠态：收藏夹仅图标，点击展开侧栏并进入收藏视图 -->
        <button v-if="sidebarCollapsed" class="home-entry tooltip-wrap" aria-label="收藏夹" @click="onCollapsedFav">
          <Icon name="star" :size="16" />
          <span class="tooltip">收藏夹</span>
        </button>
        <!-- 折叠态：会话列表仅图标，点击展开侧栏 -->
        <button v-if="sidebarCollapsed" class="home-entry session-collapsed-btn tooltip-wrap" aria-label="会话列表" @click="sidebarCollapsed = false">
          <Icon name="message-square" :size="16" />
          <span class="tooltip">会话列表</span>
        </button>
        <SessionList
          v-else
          :list="searchResults"
          :active-id="activeSessionId"
          :search="searchQuery"
          @select="onSelectSession"
        >
          <template #actions>
            <button class="head-action tooltip-wrap" aria-label="打开 Session" @click="showOpenSession = true">
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
              <HarnessMenu />
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
            <HarnessMenu collapsed />
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
                  <Icon name="folder-tree" :size="13" /> 文件
                </button>
              </div>
              <div v-show="activeSubTab === 'terminal'" class="sub-pane" :class="{ 'has-split': hostInSplit }">
                <!-- 包一层是为了给终端留 flex 容器：分屏时 .sub-pane 变成横向 flex，
                     终端必须能被压缩（min-width: 0），否则 xterm 不会 resize -->
                <div class="terminal-side">
                  <SessionTabContent
                    v-for="tab in sessionTabs"
                    :key="tab.payload?.sessionId as string"
                    v-show="activeSessionId === tab.payload?.sessionId"
                    :session-id="tab.payload?.sessionId as string"
                    :workdir="tab.payload?.workdir as string"
                    :visible="activeSessionId === tab.payload?.sessionId"
                    @open-file="onTerminalOpenFile"
                  />
                </div>
                <EditorSplitPane
                  v-if="hostInSplit"
                  @collapse="files.splitOpen = false"
                  @open-in-files="setSubTab('code')"
                />
              </div>
              <div v-show="activeSubTab === 'trace'" class="sub-pane">
                <TracePane />
              </div>
              <div v-show="activeSubTab === 'code'" class="sub-pane">
                <CodeView :visible="activeSubTab === 'code'" :editor-in-split="hostInSplit" />
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
          <div v-show="tabsStore.activeType === 'tasks'" class="content-pane">
            <TasksPane />
          </div>
          <!-- DeepSeek Harness：普通 tab pane -->
          <!-- DeepSeek Harness：iframe 始终挂载，非激活时 opacity:0 垫底。
               避免 Chromium 冻结 display:none 的跨源 iframe 导致切回时重新加载页面。 -->
          <div class="dsh-frame-wrap" :class="{ active: tabsStore.activeType === 'harness' }">
            <iframe
              v-if="harness.url"
              :src="harness.url"
              class="dsh-frame"
              allow="clipboard-read; clipboard-write"
            />
            <!-- pending 覆盖启动 / 重启 / 更新三种耗时状态，文案由 store 给 -->
            <div v-if="harness.pending" class="dsh-state">
              <Icon name="loader" :size="18" class="dsh-spinner" />
              <span>{{ harness.busyText }}</span>
            </div>
            <!-- 启动失败的报错往往是一整段 stderr 堆栈：必须左对齐、等宽、可滚动、
                 可换行。原先跟着 loading 一起居中，长文本既读不了也看不全 -->
            <div v-else-if="harness.error" class="dsh-error">
              <div class="dsh-error-head">
                <Icon name="alert-circle" :size="16" />
                <span class="dsh-error-title">DeepSeek Harness 启动失败</span>
                <div class="dsh-error-actions">
                  <button class="dsh-retry" @click="onCopyHarnessError">复制报错</button>
                  <button class="dsh-retry" @click="harness.ensure()">重试</button>
                </div>
              </div>
              <pre class="dsh-error-body">{{ harness.error }}</pre>
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
    />
    <OpenSessionDialog
      :open="showOpenSession"
      @close="showOpenSession = false"
      @create="showNewSession = true; showOpenSession = false"
      @open="onOpenRecent"
      @open-fav="onOpenFavorite"
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
import AgentBadge from '../components/AgentBadge.vue'
import TracePane from '../components/trace/TracePane.vue'
import WorkspacePanel from '../components/WorkspacePanel.vue'
import CodeView from '../components/code/CodeView.vue'
import EditorSplitPane from '../components/code/EditorSplitPane.vue'
import WelcomeTab from '../components/WelcomeTab.vue'
import SessionTabContent from '../components/SessionTabContent.vue'
import SettingsTab from '../components/SettingsTab.vue'
import GuideTab from '../components/GuideTab.vue'
import TasksPane from '../components/tasks/TasksPane.vue'
import NewSessionDialog from '../components/NewSessionDialog.vue'
import CloseSessionDialog from '../components/CloseSessionDialog.vue'
import OpenSessionDialog from '../components/OpenSessionDialog.vue'
import { useSessionsStore, sessionDisplayTitle } from '../stores/sessions'
import { useFavoritesStore, type FavoriteSession } from '../stores/favorites'
import { useTabsStore } from '../stores/tabs'
import { useTraceStore } from '../stores/trace'
import { useFilesStore } from '../stores/files'
import { useHarnessStore } from '../stores/harness'
import HarnessMenu from '../components/HarnessMenu.vue'
import type { RecentSession } from '../types/recent'
import type { SessionState } from '../types/session'
import { GetAppInfo, AdoptSession, OpenSessionTerminal, CloseSession, Logout, CloudConnectionState, GetSettings, ClipboardWrite } from '../composables/useElectron'
import { EventsOn, GetUpdateStatus } from '../composables/useElectron'
import { useWindowState } from '../composables/useWindowState'
import { pushToast } from '../composables/useToast'
import { useEventStream } from '../composables/useEventStream'
import { useAuthStore } from '../stores/auth'
import type { Tab as SettingsTabKey } from '../components/SettingsTabs.vue'

const router = useRouter()
const auth = useAuthStore()
const sessions = useSessionsStore()
const favorites = useFavoritesStore()
const tabsStore = useTabsStore()
const trace = useTraceStore()
const files = useFilesStore()
const harness = useHarnessStore()
useEventStream()

const showNewSession = ref(false)
const showOpenSession = ref(false)
// 收藏夹视图开关：侧栏导航「收藏夹」点击切换（SessionList 内展示全部收藏）
const favListOpen = ref(false)
const username = ref('')
const version = ref('')
const sidebarCollapsed = ref(false)
const workspaceCollapsed = ref(true)
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

/** 编辑器区是否由分屏右栏承载。必须用**同一个**条件驱动两处互斥渲染（分屏右栏 v-if、
 *  CodeView 的 editorInSplit），否则会出现两个 CodeEditor 实例并存 ——
 *  Monaco 对同一个 model URI 只允许一个 model，第二个会直接抛错。
 *
 *  刻意**不**带 `openFiles.length > 0`：用户当面关掉最后一个文件 tab 时，右栏保留空态
 *  （FileEditorPanel 显示「从左侧文件树选择文件」），不自动收起 —— 否则布局会在用户
 *  手下突然跳变。只有「切走会话再切回」才不恢复空右栏，那条由 stores/files.ts 的
 *  setSession 恢复守卫（`saved.splitOpen && saved.openFiles.length > 0`）负责。 */
const hostInSplit = computed(() => activeSubTab.value === 'terminal' && files.splitOpen)
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
  // 搜索作用于全部会话，退出收藏视图
  favListOpen.value = false
  searchOpen.value = true
  // 每次进搜索都刷新全量历史会话（loadAllSessions 内部去重并发；磁盘缓存后 stat-only，开销可忽略），
  // 避免重启后首次全量扫描期间搜索结果空、以及长时间运行后索引过期漏掉新会话。
  void sessions.loadAllSessions()
  nextTick(() => searchInputEl.value?.focus())
}

function closeSearch() {
  searchOpen.value = false
  searchQuery.value = ''
}

/** 会话列表数据源：无搜索时回落侧栏最近 30 条（原默认体验）；
    有搜索词时在全量历史（allOrdered，按 mtime 降序）上做大小写无关子串匹配。
    收藏项统一由 SessionList 顶部「收藏」分组展示，此处列表由 SessionList 负责剔除收藏，
    不再做收藏优先排序（避免同一会话在会话区与收藏分组重复出现）。 */
const searchResults = computed(() => {
  const q = (searchQuery.value || '').trim().toLowerCase()
  if (!q) return sessions.list
  const pool = sessions.allOrdered
  return pool.filter((s) => {
    const pn = s.project.toLowerCase()
    const wd = s.workdir.toLowerCase()
    const title = (s.user_title || s.first_prompt || s.ai_title || '').toLowerCase()
    return pn.includes(q) || wd.includes(q) || title.includes(q) || s.id.toLowerCase().includes(q)
  })
})

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

  // 预加载收藏数据，打开会话弹窗时无需等待
  void favorites.loadFavorites()

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

/** 终端里点击 workdir 内文件路径：在右侧分屏打开，终端保持可见 */
async function onTerminalOpenFile(p: { sessionId: string; workdir: string; relPath: string }) {
  if (!p.sessionId || !p.workdir || !p.relPath) return
  // 只有当前激活会话的终端可点击；不一致时忽略（防错位切 store）
  if (activeSessionId.value !== p.sessionId) return
  try {
    await files.setSession(p.sessionId, p.workdir)
    await files.openInSplit(p.relPath)
  } catch (e: any) {
    pushToast({ level: 'error', source: 'file', message: `打开文件失败：${e?.message ?? e}` })
  }
}


// 首次进入 harness tab 时加载 harness（不自动折叠左侧栏）
// 离开会话页时清理 files store（停止 watcher + 清空状态），避免残留影响终端性能
watch(
  () => tabsStore.activeType,
  (type) => {
    if (type === 'harness') void harness.ensure()
    if (type !== 'session') void files.setSession('', '')
  },
)

// 折叠态点击搜索图标：先展开侧栏再进入搜索
function onCollapsedSearch() {
  sidebarCollapsed.value = false
  openSearch()
}

/** 展开态点击「收藏夹」：切换全部会话 / 收藏视图；首次进入确保收藏已加载 */
function onToggleFavList() {
  favListOpen.value = !favListOpen.value
  if (favListOpen.value && favorites.favorites.length === 0) void favorites.loadFavorites()
}

/** 折叠态点击「收藏夹」图标：先展开侧栏再进入收藏视图 */
function onCollapsedFav() {
  sidebarCollapsed.value = false
  if (!favListOpen.value) favListOpen.value = true
  if (favorites.favorites.length === 0) void favorites.loadFavorites()
}

/** 收起态点击左侧导航图标（首页等）：先展开侧栏再执行导航；导航即退出收藏视图回全部会话 */
function onCollapsedEntry(fn: () => void) {
  if (sidebarCollapsed.value) sidebarCollapsed.value = false
  favListOpen.value = false
  fn()
}

/** 复制 harness 启动报错：长堆栈在界面上不好逐段选中，直接整段复制 */
async function onCopyHarnessError() {
  try {
    await ClipboardWrite(harness.error)
    pushToast({ level: 'info', source: 'harness', message: '报错已复制到剪贴板' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'harness', message: `复制失败：${e?.message ?? e}` })
  }
}

/** 打开 Harness（全屏 Web）：自动折叠左侧栏，让出空间；同时退出收藏视图 */
function onOpenHarness() {
  favListOpen.value = false
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

/** 打开一个已存在的会话（RecentSession）：Adopt + OpenTerminal + 开 tab + 云 bot 绑定完整链路。
    新建/打开会话/收藏三处打开已有会话共用此函数，避免复制大段逻辑。 */
async function openExistingSession(item: RecentSession, errLabel: string) {
  // 先关弹窗立即进入主界面，再后台启动 PTY/代理（避免等待异步完成才消失）
  showNewSession.value = false
  showOpenSession.value = false
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
    console.error('[home] open existing failed:', e?.message || e)
    pushToast({ level: 'error', source: 'session', message: errLabel + '失败：' + (e?.message || e) })
  }
}

function onOpenRecent(item: RecentSession) {
  void openExistingSession(item, '打开最近会话')
}

/** 打开收藏会话：favorites.toRecent 还原为 RecentSession，复用 openExistingSession */
function onOpenFavorite(sid: string) {
  const item = favorites.toRecent(sid)
  if (!item) return
  void openExistingSession(item, '打开收藏会话')
}

/** 收藏夹行标题：FavoriteSession → sessionDisplayTitle 期望形态 */
function favTitle(f: FavoriteSession): string {
  return sessionDisplayTitle({
    id: f.sessionId,
    user_title: f.userTitle,
    ai_title: f.aiTitle,
    first_prompt: f.firstPrompt,
    project: f.project,
  })
}

/** 收藏夹取消收藏 */
async function onRemoveFav(sid: string) {
  try {
    await favorites.removeFavorite(sid)
  } catch (e: any) {
    pushToast({ level: 'error', source: 'session', message: '取消收藏失败：' + (e?.message || e) })
  }
}

function openSettingsTab(tab: SettingsTabKey = 'general') {
  settingsActiveTab.value = tab
  tabsStore.openSettings()
}

function openGuideTab() {
  tabsStore.openGuide()
}

/** 折叠态点击「任务」图标：先展开侧栏再打开任务 tab */
function onCollapsedTasks() {
  sidebarCollapsed.value = false
  openTasksTab()
}

function openTasksTab() {
  tabsStore.openTasks()
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
  /* 收起态下 SessionList（flex:1）被换成图标按钮，侧栏里没有元素撑满剩余高度，
     用 margin-top:auto 吃掉空白，保证底部按钮始终贴底 */
  margin-top: auto;
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

/* 收藏夹展开区：干净列表风格，独立于会话列表 */
.fav-pane {
  margin: 0 8px 8px;
  background: var(--bg-input);
  border-radius: var(--radius-md);
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
.fav-pane-items {
  max-height: 240px; overflow-y: auto; overflow-x: hidden;
  padding: 6px;
  display: flex; flex-direction: column; gap: 2px;
}
.fav-pane-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border-radius: var(--radius-sm);
  cursor: pointer; position: relative;
}
.fav-pane-row:hover { background: var(--session-item-hover-bg); }
.fav-pane-row.active { background: var(--session-item-active-bg); }
.fav-pane-text {
  flex: 1; min-width: 0;
  font-size: var(--fs-body); color: var(--text-primary); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fav-pane-del {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border: none; background: transparent;
  color: var(--accent); border-radius: 4px; cursor: pointer; opacity: 0;
  transition: opacity 0.12s;
}
.fav-pane-row:hover .fav-pane-del { opacity: 1; }
.fav-pane-empty { padding: 12px; text-align: center; font-size: 12px; color: var(--text-tertiary); }
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
.sub-pane.has-split { flex-direction: row; }
.terminal-side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
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
/* 错误态：整体左对齐铺满，正文区自己滚动 —— 长堆栈要能看全、能选中复制 */
.dsh-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 22px;
  background: var(--bg-primary);
  overflow: hidden;
}
.dsh-error-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  color: var(--status-error);
  font-size: var(--fs-body-sm);
}
.dsh-error-title { font-weight: 600; }
.dsh-error-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.dsh-error-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 12px 14px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-family: var(--font-mono, ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
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
