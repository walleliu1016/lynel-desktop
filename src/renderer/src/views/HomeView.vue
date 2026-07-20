<template>
  <div class="home">
    <TitleBar :username="username" show-guide @settings="openSettingsTab" @guide="openGuideTab" />
    <div class="layout">
      <aside class="left" :class="{ collapsed: sidebarCollapsed }">
        <SessionList
          :list="sessions.list"
          :active-id="activeSessionId"
          :collapsed="sidebarCollapsed"
          @create="showNewSession = true"
          @select="onSelectSession"
          @toggle-collapse="sidebarCollapsed = !sidebarCollapsed"
          @open-trace="onOpenTrace"
        />
      </aside>
      <main class="right">
        <GlobalTabs
          :tabs="tabsStore.tabs"
          :active-id="tabsStore.activeId"
          @select="onSelectTab"
          @close="onCloseTab"
          @create="onCreateTab"
        />
        <div class="content">
          <div v-show="tabsStore.activeType === 'welcome'" class="content-pane">
            <WelcomeTab
              @create="showOpenFolder = true"
              @guide="openGuideTab"
              @open-recent="onOpenRecent"
            />
          </div>
          <div v-show="tabsStore.activeType === 'session'" class="content-pane">
            <template v-if="sessionTabs.length > 0">
              <SessionTabContent
                v-for="tab in sessionTabs"
                :key="tab.payload?.sessionId as string"
                v-show="activeSessionId === tab.payload?.sessionId"
                :session-id="tab.payload?.sessionId as string"
                :workdir="tab.payload?.workdir as string"
                :visible="activeSessionId === tab.payload?.sessionId"
              />
              <div v-if="!activeSessionId" class="empty">
                <div class="empty-text">未选择会话</div>
              </div>
            </template>
            <div v-else class="empty">
              <div class="empty-text">未选择会话</div>
            </div>
          </div>
          <div v-show="tabsStore.activeType === 'settings'" class="content-pane">
            <SettingsTab />
          </div>
          <div v-show="tabsStore.activeType === 'guide'" class="content-pane">
            <GuideTab />
          </div>
          <div v-show="tabsStore.activeType === 'trace'" class="content-pane">
            <template v-for="tab in traceTabs" :key="tab.id">
              <TraceTab
                v-if="tab.payload"
                v-show="activeTraceId === tab.id"
                :work-dir="(tab.payload.workdir as string)"
                :session-id="(tab.payload.sessionId as string)"
              />
            </template>
          </div>
        </div>
      </main>
    </div>
    <OpenFolderDialog
      :open="showOpenFolder"
      :loading="sessions.creating"
      @close="showOpenFolder = false"
      @create="onCreateFromFolder"
    />
    <NewSessionDialog
      :open="showNewSession"
      :loading="sessions.creating"
      @close="showNewSession = false"
      @create="onCreateFromSession"
      @open-recent="onOpenRecent"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import GlobalTabs from '../components/GlobalTabs.vue'
import SessionList from '../components/SessionList.vue'
import TraceTab from '../components/trace/TraceTab.vue'
import WelcomeTab from '../components/WelcomeTab.vue'
import SessionTabContent from '../components/SessionTabContent.vue'
import SettingsTab from '../components/SettingsTab.vue'
import GuideTab from '../components/GuideTab.vue'
import OpenFolderDialog from '../components/OpenFolderDialog.vue'
import NewSessionDialog from '../components/NewSessionDialog.vue'
import { useSessionsStore, sessionDisplayTitle } from '../stores/sessions'
import { useTabsStore } from '../stores/tabs'
import type { RecentSession } from '../types/recent'
import type { SessionState } from '../types/session'
import { GetAppInfo, AdoptSession, OpenSessionTerminal, CloseSession } from '../composables/useElectron'
import { useEventStream } from '../composables/useEventStream'

const router = useRouter()
const sessions = useSessionsStore()
const tabsStore = useTabsStore()
useEventStream()

const showOpenFolder = ref(false)
const showNewSession = ref(false)
const username = ref('')
const sidebarCollapsed = ref(false)

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
const traceTabs = computed(() => tabsStore.tabs.filter((t) => t.type === 'trace'))
const activeTraceId = computed(() => {
  if (activeTab.value?.type !== 'trace') return null
  return activeTab.value.id
})

onMounted(async () => {
  try {
    const info = await GetAppInfo()
    username.value = info.username
  } catch {}
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
      const ok = window.confirm('该会话仍在运行中，关闭将终止 Claude，是否继续？')
      if (!ok) return
    }
    try {
      await CloseSession(sid)
    } catch (e: any) {
      console.error('[home] close session failed:', e?.message || e)
    }
    sessions.remove(sid)
  }

  tabsStore.close(id)
}

async function onSelectSession(id: string) {
  const meta = sessions.list.find((s) => s.id === id)
  if (!meta) return
  tabsStore.openSession(id, meta.workdir, sessionDisplayTitle(meta))
  void sessions.select(id)
}

function onOpenTrace(meta: { id: string; workdir: string }) {
  tabsStore.openTrace(meta.id, meta.workdir)
}

async function onCreate(workdir: string, prompt: string, extraArgs: string[] = []) {
  try {
    const id = await sessions.create(workdir, prompt, extraArgs)
    const meta = sessions.list.find((s) => s.id === id)
    if (meta) {
      tabsStore.openSession(id, meta.workdir, sessionDisplayTitle(meta) || prompt)
    }
  } catch (e: any) {
    alert('创建失败：' + (e?.message ?? e))
  }
}

async function onCreateFromFolder(workdir: string, prompt: string, extraArgs: string[] = []) {
  await onCreate(workdir, prompt, extraArgs)
  showOpenFolder.value = false
}

async function onCreateFromSession(workdir: string, prompt: string, extraArgs: string[] = []) {
  await onCreate(workdir, prompt, extraArgs)
  showNewSession.value = false
}

async function onOpenRecent(item: RecentSession) {
  try {
    sessions.open(item)
    tabsStore.openSession(item.sessionId, item.workdir, sessionDisplayTitle({
      id: item.sessionId,
      user_title: item.userTitle,
      ai_title: item.aiTitle,
      first_prompt: item.firstPrompt,
    }))
    await AdoptSession(item.sessionId, item.workdir)
    await OpenSessionTerminal(item.sessionId, item.workdir)
    showNewSession.value = false
  } catch (e: any) {
    console.error('[home] open recent failed:', e?.message || e)
    alert('打开最近会话失败：' + (e?.message || e))
  }
}

function openSettingsTab() {
  tabsStore.openSettings()
}

function openGuideTab() {
  tabsStore.openGuide()
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
.home { display: flex; flex-direction: column; height: 100vh; }
.layout { flex: 1; display: flex; min-height: 0; gap: 1px; background: var(--border); }
.left {
  width: 280px; display: flex; flex-direction: column;
  background: var(--bg-panel);
  box-shadow: var(--shadow-panel);
  min-height: 0; overflow: hidden;
  z-index: 1;
  transition: width 0.2s ease;
}
.left.collapsed { width: 44px; }
.right { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg-primary); }
.content { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; position: relative; }
.content-pane { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.empty { flex: 1; display: flex; align-items: center; justify-content: center; }
.empty-text { color: var(--text-tertiary); font-size: 12px; }
</style>
