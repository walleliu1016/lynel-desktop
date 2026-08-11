<template>
  <div v-if="open" class="overlay" @click.self="$emit('close')">
    <SpringTransition>
    <div class="dialog">
      <div class="head">
        <h2>打开 Session</h2>
        <button class="close" aria-label="关闭" title="关闭" @click="$emit('close')">
          <Icon name="close" :size="14" />
        </button>
      </div>
      <div class="tabs">
        <button
          class="tab"
          :class="{ active: tab === 'history' }"
          @click="tab = 'history'"
        >
          历史会话
        </button>
        <button
          class="tab"
          :class="{ active: tab === 'new' }"
          @click="tab = 'new'"
        >
          打开新目录
        </button>
      </div>
      <div class="body">
        <div v-if="tab === 'history'" class="tab-panel">
          <div v-if="recent.loading" class="empty">加载中…</div>
          <template v-else>
            <div v-if="recent.recentSessions.length" class="history-search">
              <Icon name="search" :size="12" class="search-icon" />
              <input
                v-model="historySearch"
                class="search-input"
                placeholder="搜索历史会话（项目 / 标题 / 目录）"
                @keydown.escape="historySearch = ''"
              />
              <button v-if="historySearch" class="search-clear" aria-label="清除搜索" title="清除搜索" @click="historySearch = ''">
                <Icon name="close" :size="12" />
              </button>
            </div>
            <div v-if="recent.recentSessions.length" class="count-row">
              <span>{{ historySearch ? `${filteredRecentSessions.length} / ${recent.recentSessions.length}` : `共 ${recent.recentSessions.length} 个` }}</span>
            </div>
            <div v-if="!filteredRecentSessions.length" class="empty">{{ historySearch ? '无匹配结果' : '暂无历史会话' }}</div>
            <RecentSessionList
              v-else
              :list="filteredRecentSessions"
              :limit="10"
              @select="onRecent"
            />
          </template>
        </div>
        <form v-else @submit.prevent="onSubmit" class="tab-panel new-form">
          <div class="form-group">
            <label class="form-label">工作目录</label>
            <div class="dir-row">
              <input class="form-input" v-model="workdir" placeholder="点击右侧按钮选择目录" readonly :disabled="loading" @click="onPick" />
              <button type="button" class="pick-btn" :disabled="loading" @click="onPick">选择…</button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Agent 类型</label>
            <AgentSelect v-model="agent" />
          </div>
          <div class="form-group">
            <label class="form-label">提示词（可选）</label>
            <textarea class="form-input area" v-model="prompt" rows="4" :placeholder="isClaude ? '你想让 Claude 做什么？' : `你想让 ${agentMeta(agent).short} 做什么？`" :disabled="loading"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">{{ isClaude ? 'Claude 选项' : '启动选项' }}</label>
            <div v-if="isClaude" class="multi-select" :class="{ open: flagsOpen }">
              <div class="select-trigger" @click="flagsOpen = !flagsOpen">
                <span v-if="selectedFlags.length === 0" class="placeholder">无额外参数</span>
                <span v-else>{{ selectedFlags.join(', ') }}</span>
                <Icon name="chevron-down" :size="12" class="arrow" :class="{ flip: flagsOpen }" />
              </div>
              <div v-if="flagsOpen" class="select-dropdown">
                <label v-for="f in flagOptions" :key="f.value" class="flag-option" @click.stop>
                  <input type="checkbox" :value="f.value" v-model="selectedFlags" />
                  <span class="flag-label">{{ f.label }}</span>
                  <span class="flag-desc">{{ f.desc }}</span>
                </label>
              </div>
            </div>
            <div v-else class="option-disabled">该 agent 暂不支持额外参数</div>
          </div>
          <div class="form-group">
            <label class="form-label">绑定机器人（可选）</label>
            <select class="form-input" v-model="selectedBot">
              <option value="">不绑定</option>
              <option
                v-for="b in botOptions"
                :key="b.id"
                :value="b.id"
                :disabled="!isBotAvailable(b.id)"
              >
                {{ b.name }}{{ getBotBoundSessionName(b.id) ? `（已绑定 ${getBotBoundSessionName(b.id)}）` : '' }}
              </option>
            </select>
          </div>
          <div class="form-actions">
            <button type="button" class="cancel" :disabled="loading" @click="$emit('close')">取消</button>
            <button type="submit" class="primary" :disabled="!workdir.trim() || loading">
              <span v-if="loading" class="spinner" />
              {{ loading ? '创建中...' : '打开' }}
            </button>
          </div>
        </form>
      </div>
    </div>
    </SpringTransition>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import Icon from './Icon.vue'
import SpringTransition from './SpringTransition.vue'
import AgentSelect from './AgentSelect.vue'
import RecentSessionList from './RecentSessionList.vue'
import { useRecentStore } from '../stores/recent'
import { useBotsStore } from '../stores/bots'
import { useSessionsStore } from '../stores/sessions'
import type { RecentSession } from '../types/recent'
import { agentMeta, type AgentKind } from '../types/agents'
import { PickDirectory } from '../composables/useElectron'
import { useRecentSessionSearch } from '../composables/useRecentSessionSearch'

const props = defineProps<{ open: boolean; loading?: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create', workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind): void
  (e: 'open-recent', item: RecentSession): void
}>()

const recent = useRecentStore()
const botsStore = useBotsStore()
const sessions = useSessionsStore()
const tab = ref<'history' | 'new'>('history')
const workdir = ref('')
const prompt = ref('')
const agent = ref<AgentKind>('claude')
const flagsOpen = ref(false)
const selectedFlags = ref<string[]>([])
const selectedBot = ref('')
const isClaude = computed(() => agent.value === 'claude')
const botOptions = computed(() => botsStore.bots)
const { search: historySearch, filtered: filteredRecentSessions } = useRecentSessionSearch()

function isBotAvailable(botId: string): boolean {
  const sessionId = sessions.botBindings[botId] || sessions.sessionBots[botId]
  return !sessionId
}

function getBotBoundSessionName(botId: string): string | undefined {
  const sessionId = sessions.botBindings[botId] || sessions.sessionBots[botId]
  if (!sessionId) return undefined
  return sessions.getBotBoundSessionName(botId)
}

const flagOptions = [
  { value: '--verbose', label: '--verbose', desc: '输出详细的调试信息' },
  { value: '--debug', label: '--debug', desc: '启用调试模式' },
]

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    void recent.loadRecentSessions()
    void botsStore.load()
    void sessions.loadBotBindings()
    workdir.value = ''
    prompt.value = ''
    agent.value = 'claude'
    selectedFlags.value = []
    selectedBot.value = ''
    flagsOpen.value = false
    historySearch.value = ''
    tab.value = recent.recentSessions.length ? 'history' : 'new'
  }
})

watch(agent, () => {
  if (agent.value !== 'claude') {
    selectedFlags.value = []
    flagsOpen.value = false
  }
})

function onRecent(item: RecentSession) {
  emit('open-recent', item)
}

async function onPick() {
  try {
    const dir = await PickDirectory()
    if (dir) workdir.value = dir
  } catch {}
}

function onSubmit() {
  if (!workdir.value.trim() || props.loading) return
  emit('create', workdir.value.trim(), prompt.value.trim(), [...selectedFlags.value], selectedBot.value || undefined, agent.value)
}
</script>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: var(--scrim);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.dialog {
  width: 520px;
  max-width: calc(100% - 40px);
  max-height: calc(100vh - 80px);
  background: var(--material-bg, rgba(255,255,255,0.72));
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--border); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px 10px; }
h2 { font-size: 14px; color: var(--text-primary); margin: 0; }
.close { color: var(--text-secondary); padding: 2px 6px; border-radius: var(--radius-sm); display: flex; align-items: center; }
.close:hover { background: var(--bg-input); color: var(--text-primary); }
.tabs {
  display: flex; gap: 4px; padding: 0 20px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tab {
  padding: 6px 10px; border-radius: var(--radius-md);
  font-size: 12px; font-weight: 600; color: var(--text-secondary);
  background: transparent; border: none;
  transition: background 0.15s, color 0.15s;
}
.tab:hover { color: var(--text-primary); background: var(--bg-input); }
.tab:active { background: var(--border); }
.tab.active { color: var(--accent); background: var(--accent-soft-bg); }
.body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 16px 20px 20px;
}
.tab-panel { min-height: 0; }
.empty { padding: 24px; text-align: center; font-size: 12px; color: var(--text-tertiary); }
.history-search {
  position: relative; margin-bottom: 8px;
}
.history-search .search-icon {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  color: var(--text-tertiary); pointer-events: none;
}
.history-search .search-input {
  width: 100%; height: 32px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 0 28px 0 30px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
  outline: none; transition: border-color 0.15s;
}
.history-search .search-input:focus { border-color: var(--accent); }
.history-search .search-input::placeholder { color: var(--text-tertiary); }
.history-search .search-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); border-radius: 50%;
}
.history-search .search-clear:hover { background: var(--border); color: var(--text-primary); }
.count-row {
  font-size: 11px; color: var(--text-tertiary);
  padding: 0 2px 8px;
}
.new-form { display: flex; flex-direction: column; }
.form-group { margin-bottom: 12px; }
.form-label { display: block; font-size: 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
.dir-row { display: flex; gap: 8px; }
.dir-row .form-input { flex: 1; cursor: pointer; }
.form-input {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border-strong);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: var(--fs-body-sm); font-family: inherit;
}
.form-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft-bg); }
.pick-btn {
  padding: 8px 14px; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); color: var(--text-primary); font-size: 12px;
  white-space: nowrap; cursor: pointer;
}
.pick-btn:hover { background: var(--border); }
.area { resize: vertical; min-height: 80px; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.cancel { background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: 6px 14px; font-size: var(--fs-body-sm); }
.cancel:hover { border-color: var(--accent); color: var(--accent); }
.primary { padding: 7px 18px; background: var(--accent); color: var(--text-inverse); border: none; border-radius: var(--radius-md); font-size: var(--fs-body-sm); font-weight: 500; }
.primary:hover:not(:disabled) { filter: brightness(1.06); }
.primary:active:not(:disabled) { transform: scale(0.97); }
.primary:disabled { opacity: 0.7; cursor: not-allowed; display: inline-flex; align-items: center; gap: 6px; }
.cancel:disabled { opacity: 0.5; cursor: not-allowed; }
.form-input:disabled { opacity: 0.6; cursor: not-allowed; }
.pick-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.spinner {
  width: 11px; height: 11px;
  border: 2px solid var(--border);
  border-top-color: var(--text-inverse);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.option-disabled {
  padding: 8px 10px; background: var(--bg-input); border: 1px dashed var(--border);
  border-radius: var(--radius-md); font-size: 12px; color: var(--text-tertiary);
}
.multi-select { position: relative; user-select: none; }
.select-trigger {
  display: flex; align-items: center; gap: 6px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  font-size: 12px; color: var(--text-primary); cursor: pointer;
}
.select-trigger:hover { border-color: var(--accent); }
.placeholder { color: var(--text-tertiary); }
.arrow { color: var(--text-tertiary); transition: transform 0.2s; flex-shrink: 0; }
.arrow.flip { transform: rotate(180deg); }
.select-dropdown {
  position: absolute; top: 100%; left: 0; right: 0;
  margin-top: 2px; background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius-md); z-index: 10; padding: 4px;
  box-shadow: var(--shadow-window);
}
.flag-option {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: var(--radius-sm); cursor: pointer;
  font-size: 12px;
}
.flag-option:hover { background: var(--bg-input); }
.flag-option input[type="checkbox"] { accent-color: var(--accent); flex-shrink: 0; }
.flag-label { color: var(--text-primary); font-family: var(--font-mono); white-space: nowrap; }
.flag-desc { color: var(--text-tertiary); margin-left: auto; font-size: 11px; }
</style>
