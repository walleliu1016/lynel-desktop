<template>
  <div class="welcome">
    <TitleBar />
    <div class="welcome-body">
      <div class="card">
        <div class="brand">
          <span class="brand-lynel">Lynel</span>
          <span class="brand-desktop">Desktop</span>
        </div>
        <div class="start-section">
          <div class="section-title">Start</div>
          <button class="open-folder" @click="onOpenFolder">
            <Icon name="plus" :size="16" />
            <span>Open Folder...</span>
          </button>
        </div>
        <div class="recent-section">
          <div class="section-header">
            <div class="section-title">Recent Sessions</div>
            <span v-if="recent.recentSessions.length" class="count">{{ recentSearchText ? `${filteredRecent.length} / ${recent.recentSessions.length}` : recent.recentSessions.length }}</span>
          </div>
          <div v-if="recent.loading" class="loading">加载中...</div>
          <template v-else>
            <div v-if="recent.recentSessions.length" class="recent-search">
              <Icon name="search" :size="12" class="search-icon" />
              <input
                v-model="recentSearchText"
                class="search-input"
                placeholder="搜索（项目 / 标题 / 目录）"
                @keydown.escape="recentSearchText = ''"
              />
              <button v-if="recentSearchText" class="search-clear" aria-label="清除搜索" title="清除搜索" @click="recentSearchText = ''">
                <Icon name="close" :size="12" />
              </button>
            </div>
            <div v-if="!filteredRecent.length" class="loading">{{ recentSearchText ? '无匹配结果' : '暂无历史会话' }}</div>
            <RecentSessionList
              v-else
              :list="filteredRecent"
              :limit="6"
              @select="onSelectRecent"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import Icon from '../components/Icon.vue'
import RecentSessionList from '../components/RecentSessionList.vue'
import { useRecentStore } from '../stores/recent'
import { useSessionsStore } from '../stores/sessions'
import type { RecentSession } from '../types/recent'
import { PickDirectory, AdoptSession, OpenSessionTerminal } from '../composables/useElectron'
import { useWindowState } from '../composables/useWindowState'
import { useRecentSessionSearch } from '../composables/useRecentSessionSearch'

const router = useRouter()
const recent = useRecentStore()
const sessions = useSessionsStore()
const win = useWindowState()
const { search: recentSearchText, filtered: filteredRecent } = useRecentSessionSearch()

onMounted(() => {
  void recent.loadRecentSessions()
})

async function onOpenFolder() {
  try {
    await win.applyHomeLayout()
    router.push('/home')
  } catch (e: any) {
    console.error('[welcome] go home failed:', e?.message || e)
  }
}

async function onSelectRecent(item: RecentSession) {
  try {
    sessions.open(item)
    await AdoptSession(item.sessionId, item.workdir)
    await OpenSessionTerminal(item.sessionId, item.workdir)
    await win.applyHomeLayout()
    router.push('/home')
  } catch (e: any) {
    console.error('[welcome] open recent failed:', e?.message || e)
    alert('打开最近会话失败：' + (e?.message || e))
  }
}
</script>

<style scoped>
.welcome { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.welcome-body {
  flex: 1; display: flex; align-items: center; justify-content: center;
  background: var(--bg-primary); padding: 24px;
  min-height: 0;
  overflow-x: hidden;
}
.card {
  width: min(520px, 100%);
  max-height: min(720px, calc(100% - 48px));
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
  padding: 28px 28px 22px;
  display: flex; flex-direction: column;
  overflow: hidden;
  overflow-x: hidden;
}
.brand {
  display: flex; align-items: center; gap: 6px;
  font-size: 20px; font-weight: 700; margin-bottom: 24px;
}
.brand-lynel { color: var(--accent); }
.brand-desktop { color: var(--text-tertiary); font-weight: 500; }
.start-section { margin-bottom: 22px; }
.recent-section {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.section-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
}
.section-title {
  font-size: 11px; font-weight: 700; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.open-folder {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-primary); font-size: 14px; font-weight: 500;
  transition: all 0.15s;
}
.open-folder:hover {
  border-color: var(--accent);
  background: var(--accent-soft-bg); color: var(--accent);
}
.count {
  font-size: 10px; font-weight: 700;
  padding: 1px 6px; border-radius: 999px;
  background: var(--accent-soft-bg); color: var(--accent);
}
.loading {
  padding: 16px; text-align: center;
  font-size: 12px; color: var(--text-secondary);
}
.recent-search {
  position: relative; margin-bottom: 10px;
}
.recent-search .search-icon {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  color: var(--text-tertiary); pointer-events: none;
}
.recent-search .search-input {
  width: 100%; height: 32px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 0 28px 0 30px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
  outline: none; transition: border-color 0.15s;
}
.recent-search .search-input:focus { border-color: var(--accent); }
.recent-search .search-input::placeholder { color: var(--text-tertiary); }
.recent-search .search-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); border-radius: 50%;
}
.recent-search .search-clear:hover { background: var(--border); color: var(--text-primary); }
</style>
