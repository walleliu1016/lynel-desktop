<template>
  <div class="home-tab">
    <div class="card">
      <div class="brand">
        <div class="brand-name">
          <span class="brand-lynel">Lynel</span>
          <span class="brand-desktop">Desktop</span>
        </div>
        <button class="guide-btn" @click="$emit('guide')">
          <Icon name="help" :size="15" />
          <span>使用指南</span>
        </button>
      </div>
      <p class="tagline">集成 Claude / Codex / OpenCode 的多 Agent 桌面终端，请求与成本全程可视化，权限审批经企业微信与手机远程完成。</p>
      <div class="badges">
        <span class="badge">多 Agent 终端</span>
        <span class="badge">请求可视化</span>
        <span class="badge">远程审批</span>
      </div>
      <QuickLaunch class="quick" :loading="creating" @create="onQuickCreate" />
      <div class="recent-section">
        <div class="section-header">
          <div class="section-title">历史会话</div>
          <span v-if="recent.recentSessions.length" class="count">{{ recentSearchText ? `${filteredRecent.length} / ${recent.recentSessions.length}` : recent.recentSessions.length }}</span>
        </div>
        <div v-if="recent.loading" class="loading">加载中...</div>
        <template v-else>
          <div class="recent-search">
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
            :limit="10"
            @select="$emit('open-recent', $event)"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Icon from './Icon.vue'
import QuickLaunch from './QuickLaunch.vue'
import RecentSessionList from './RecentSessionList.vue'
import { useRecentStore } from '../stores/recent'
import { useSessionsStore } from '../stores/sessions'
import { useRecentSessionSearch } from '../composables/useRecentSessionSearch'
import type { AgentKind } from '../types/agents'
import type { RecentSession } from '../types/recent'

const recent = useRecentStore()
const sessions = useSessionsStore()
const { search: recentSearchText, filtered: filteredRecent } = useRecentSessionSearch()

// 创建中 loading 直接绑定全局 store，创建成功/失败后自动复位
const creating = computed(() => sessions.creating)

const emit = defineEmits<{
  guide: []
  create: [workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind]
  'open-recent': [item: RecentSession]
}>()

function onQuickCreate(workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind) {
  emit('create', workdir, prompt, extraArgs, botId, agent)
}

onMounted(() => {
  void recent.loadRecentSessions()
})
</script>

<style scoped>
.home-tab {
  flex: 1; display: flex; align-items: center; justify-content: center;
  background: var(--bg-primary); padding: 24px; min-height: 0; overflow: auto;
}
.card {
  width: min(680px, 100%); max-height: min(760px, calc(100% - 48px));
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-panel);
  padding: 28px 28px 22px; display: flex; flex-direction: column; overflow: hidden;
}
.brand { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.brand-name { display: flex; align-items: center; gap: 6px; font-size: 24px; font-weight: 700; }
.brand-lynel { color: var(--accent); }
.brand-desktop { color: var(--status-error); font-weight: 500; }
.guide-btn {
  display: flex; align-items: center; gap: 6px; padding: 7px 14px;
  border: none; border-radius: var(--radius-md); background: var(--accent);
  color: var(--text-inverse); font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
}
.guide-btn:hover { background: var(--accent-deep); }
.tagline {
  margin: 6px 0 10px; font-size: 13px; color: var(--text-secondary);
  text-align: center; line-height: 1.6;
}
.badges { display: flex; justify-content: center; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
.badge {
  padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600;
  color: var(--accent); background: var(--accent-soft-bg);
}
.quick { margin-bottom: 22px; }
.recent-section { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.section-title { font-size: 11px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.count { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: var(--accent-soft-bg); color: var(--accent); }
.loading { padding: 16px; text-align: center; font-size: 12px; color: var(--text-secondary); }
.recent-search { position: relative; margin-bottom: 10px; }
.recent-search .search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); pointer-events: none; }
.recent-search .search-input {
  width: 100%; height: 32px; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 0 28px 0 30px; color: var(--text-primary);
  font-size: 12px; font-family: inherit; outline: none; transition: border-color 0.15s;
}
.recent-search .search-input:focus { border-color: var(--accent); }
.recent-search .search-input::placeholder { color: var(--text-tertiary); }
.recent-search .search-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); border-radius: 50%; border: none; background: transparent; cursor: pointer;
}
.recent-search .search-clear:hover { background: var(--border); color: var(--text-primary); }
</style>
