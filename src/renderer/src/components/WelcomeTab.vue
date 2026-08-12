<template>
  <div class="home-tab">
    <SpringTransition>
      <div class="card">
        <div class="hero">
          <div class="brand">
            <div class="brand-name">
              <span class="brand-lynel">Lynel</span>
              <span class="brand-desktop">Desktop</span>
            </div>
          </div>
          <p class="tagline">一个终端，调度所有 Agent——请求、成本、审批，全程透明可控。</p>
          <ul class="feats">
            <li>
              <Icon name="terminal" :size="14" />
              <span>Claude / Codex / OpenCode / OMP 四款 Agent 统一调度</span>
            </li>
            <li>
              <Icon name="activity" :size="14" />
              <span>API 调用逐笔透明——模型、Token、延迟、费用一目了然</span>
            </li>
            <li>
              <Icon name="smartphone" :size="14" />
              <span>权限请求推送企业微信与手机，远程一键审批，流程不被打断</span>
            </li>
          </ul>
          <QuickLaunch class="quick" :loading="creating" @create="onQuickCreate" />
        </div>
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
    </SpringTransition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Icon from './Icon.vue'
import QuickLaunch from './QuickLaunch.vue'
import RecentSessionList from './RecentSessionList.vue'
import SpringTransition from './SpringTransition.vue'
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
  flex: 1; display: flex; flex-direction: column; align-items: center;
  background: var(--bg-primary); padding: 24px; min-height: 0; overflow: auto;
}
.card {
  width: 100%; max-width: 860px;
  flex: 1 1 auto; min-height: 0;
  padding: 8px 4px 22px; display: flex; flex-direction: column; overflow: hidden;
}
.hero { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 0 16px; }
.brand { display: flex; justify-content: center; margin-bottom: 14px; }
.brand-name { display: flex; align-items: center; gap: 8px; font-size: var(--fs-hero); font-weight: 700; letter-spacing: -0.02em; }
.brand-lynel { color: var(--accent); }
.brand-desktop { color: var(--status-error); font-weight: 500; }
.tagline {
  margin: 6px 0 14px; font-size: var(--fs-body); color: var(--text-secondary);
  text-align: center; line-height: 1.6; max-width: 600px;
}
.feats {
  list-style: none; padding: 0; margin: 0 0 18px;
  width: 100%; max-width: 520px;
  display: flex; flex-direction: column; align-items: flex-start; gap: 9px;
}
.feats li {
  display: flex; align-items: center; gap: 10px;
  font-size: var(--fs-body-sm); color: var(--text-secondary); line-height: 1.5;
  text-align: left;
}
.feats li svg { color: var(--accent); flex: 0 0 14px; }
.quick { width: 100%; max-width: 720px; }
.recent-section { flex: 0 1 auto; max-height: 42%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; margin-top: 18px; }
.section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.section-title { font-size: var(--fs-caption); font-weight: 700; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
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
