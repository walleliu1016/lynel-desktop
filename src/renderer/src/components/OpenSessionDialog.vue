<template>
  <!-- Teleport 到 body：与 NewSessionDialog / CloseSessionDialog 一致，脱离 .home 层级，避免被中间终端区域的合成层盖住 -->
  <Teleport to="body">
    <div class="overlay" :class="{ open }" @click.self="open && $emit('close')">
      <SpringTransition>
        <div v-if="open" class="dialog" role="dialog" aria-modal="true">
          <div class="head">
            <h2>打开会话</h2>
            <div class="head-actions">
              <button class="new-btn" title="打开新目录 / 新建会话" @click="$emit('create')">
                <Icon name="plus" :size="13" />
                新建会话
              </button>
              <button class="close" aria-label="关闭" title="关闭" @click="$emit('close')">
                <Icon name="close" :size="14" />
              </button>
            </div>
          </div>
          <div class="scroll">
            <!-- 收藏区：无收藏整块隐藏 -->
            <template v-if="favList.length">
              <div class="fav-title">★ 收藏（{{ favList.length }}）</div>
              <div class="fav-items">
                <div v-for="item in favList" :key="item.sessionId" class="row fav-item" @click="openFav(item.sessionId)">
                  <span class="status-dot" :class="dotClass(item.state)" />
                  <AgentBadge :agent="item.agent" size="sm" class="row-agent" />
                  <span class="row-title" :title="favDisplay(item)">{{ favDisplay(item) }}</span>
                  <FavoriteStar :session-id="item.sessionId" class="row-star" @toggle="removeFav(item.sessionId)" />
                  <span class="row-project">{{ item.project }}</span>
                </div>
              </div>
            </template>
            <!-- 最近历史（数据源 sessions.allOrdered 全量） -->
            <div class="hist-head">
              <span class="hist-title">历史会话 · 共 {{ list.length }} 个</span>
              <div v-if="list.length" class="hist-search">
                <Icon name="search" :size="12" class="search-icon" />
                <input v-model="q" class="search-input" placeholder="搜索历史会话（项目 / 标题 / 目录）" @keydown.escape="q = ''" />
                <button v-if="q" class="search-clear" aria-label="清除搜索" title="清除搜索" @click="q = ''">
                  <Icon name="close" :size="12" />
                </button>
              </div>
            </div>
            <div v-if="filtered.length" class="hist-list">
              <div v-for="s in filtered" :key="s.id" class="row hist-item" @click="openSession(s)">
                <span class="status-dot" :class="dotClass(sessions.state[s.id])" />
                <AgentBadge :agent="s.agent" size="sm" class="row-agent" />
                <span class="row-title" :title="sessionDisplayTitle(s)">{{ sessionDisplayTitle(s) }}</span>
                <FavoriteStar :session-id="s.id" class="row-star" @toggle="toggleHist(s)" />
                <span class="row-project">{{ s.project }}</span>
              </div>
            </div>
            <div v-else class="empty">{{ q ? '无匹配结果' : '暂无历史会话' }}</div>
          </div>
        </div>
      </SpringTransition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import SpringTransition from './SpringTransition.vue'
import AgentBadge from './AgentBadge.vue'
import FavoriteStar from './FavoriteStar.vue'
import { useFavoritesStore, toFavorite, type FavoriteSession } from '../stores/favorites'
import { useSessionsStore, sessionDisplayTitle } from '../stores/sessions'
import type { SessionMeta } from '../types/session'
import type { RecentSession } from '../types/recent'
import { pushToast } from '../composables/useToast'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  /** 跳转新建（打开新目录 / 新建会话），由 HomeView 关本弹窗并打开 NewSessionDialog */
  (e: 'create'): void
  /** 点击历史会话行：转成 RecentSession 交给 HomeView 复用 onOpenRecent */
  (e: 'open', item: RecentSession): void
  /** 点击收藏行：只传 sessionId，HomeView 用 favorites.toRecent 还原 */
  (e: 'open-fav', sid: string): void
}>()

const sessions = useSessionsStore()
const favorites = useFavoritesStore()

// 弹窗打开时加载数据：收藏每次打开都刷新；历史走懒加载（全量已就绪则不重复拉取）
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  void favorites.loadFavorites()
  if (sessions.allOrdered.length === 0) void sessions.loadAllSessions()
})

// 收藏会话已在顶部「收藏」区展示，历史列表剔除收藏项，避免同一会话重复出现
const favIds = computed(() => new Set(favorites.favorites.map((f) => f.sessionId)))
// 历史列表数据源：全量会话按 mtime 降序（sessions.allOrdered），非 recents 30 条
const list = computed(() => sessions.allOrdered.filter((s) => !favIds.value.has(s.id)))
const favList = computed(() => favorites.favorites)

// 历史搜索：对标题 / project / workdir 做大小写无关子串过滤；无关键词返回全量
const q = ref('')
const filtered = computed<SessionMeta[]>(() => {
  const kw = q.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter((s) => {
    const title = sessionDisplayTitle(s).toLowerCase()
    const project = (s.project || '').toLowerCase()
    const workdir = (s.workdir || '').toLowerCase()
    return title.includes(kw) || project.includes(kw) || workdir.includes(kw)
  })
})

// 状态点配色（沿用 RecentSessionList 的语义：绿=运行 / 红=待审批 / 空心=ended）
function dotClass(st?: string): string {
  if (st === 'running' || st === 'waiting' || st === 'thinking' || st === 'streaming' || st === 'running_tool') return 'running'
  if (st === 'awaiting_permission') return 'awaiting_permission'
  if (st === 'ended') return 'ended'
  if (st === 'done') return 'done'
  return ''
}

/** 收藏项标题：FavoriteSession 字段名转成 sessionDisplayTitle 期望形态 */
function favDisplay(item: FavoriteSession): string {
  return sessionDisplayTitle({
    id: item.sessionId,
    user_title: item.userTitle,
    ai_title: item.aiTitle,
    first_prompt: item.firstPrompt,
    project: item.project,
  })
}

/** 历史行点击：转成 RecentSession 上抛，HomeView 复用 onOpenRecent 完整打开链路 */
function openSession(s: SessionMeta) {
  emit('open', toFavorite(s))
}

/** 收藏行点击：只上抛 sessionId，HomeView 用 favorites.toRecent(sid) 还原后走同一打开链路 */
function openFav(sid: string) {
  emit('open-fav', sid)
}

function removeFav(sid: string) {
  favorites.removeFavorite(sid).catch((e: any) => {
    pushToast({ level: 'error', source: 'session', message: '取消收藏失败：' + (e?.message ?? e) })
  })
}

/** 历史行悬停星标：未收藏则加星（进顶部收藏区并从本列表移除），已收藏则取消 */
function toggleHist(s: SessionMeta) {
  const sid = s.id
  if (favorites.isFavorite(sid)) {
    favorites.removeFavorite(sid).catch((e: any) => {
      pushToast({ level: 'error', source: 'session', message: '取消收藏失败：' + (e?.message ?? e) })
    })
  } else {
    favorites.addFavorite(toFavorite(s)).catch((e: any) => {
      pushToast({ level: 'error', source: 'session', message: '收藏失败：' + (e?.message ?? e) })
    })
  }
}
</script>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: var(--scrim);
  display: flex; align-items: center; justify-content: center;
  /* Teleport 到 body 顶层后，z-index 提到接近 toast，确保盖住终端合成层 */
  z-index: 9998;
  opacity: 0; pointer-events: none;
  transition: opacity 0.2s ease;
}
.overlay.open { opacity: 1; pointer-events: auto; }
.dialog {
  width: 560px;
  max-width: calc(100% - 40px);
  height: min(520px, calc(100vh - 80px));
  background: var(--bg-panel);
  border: 1px solid var(--border); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 16px 20px 10px; flex-shrink: 0; }
h2 { font-size: 14px; color: var(--text-primary); margin: 0; }
.head-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
/* 「新建会话」跳转按钮：实心 accent 强调，易发现 */
.new-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 12px; border: 1px solid var(--accent); border-radius: var(--radius-md);
  background: var(--accent); color: var(--text-inverse);
  font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer; white-space: nowrap;
  transition: filter 0.15s, box-shadow 0.15s;
}
.new-btn:hover { filter: brightness(1.08); }
.new-btn:active { transform: scale(0.98); }
.close { color: var(--text-secondary); padding: 2px 6px; border-radius: var(--radius-sm); display: flex; align-items: center; }
.close:hover { background: var(--bg-hover); color: var(--text-primary); }
/* 纵向滚动容器：head 固定，其余内容在此滚动（收藏区 + 历史区） */
.scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 12px 12px; }
.fav-title {
  font-size: 11px; font-weight: 700; color: var(--text-secondary);
  padding: 2px 6px 6px; letter-spacing: 0.3px;
}
.fav-items { margin-bottom: 6px; }
.hist-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 6px 6px;
  border-top: 1px solid var(--border);
}
.hist-title { font-size: 11px; font-weight: 700; color: var(--text-secondary); letter-spacing: 0.3px; flex-shrink: 0; }
.hist-search { position: relative; flex: 1; max-width: 240px; }
.hist-search .search-icon {
  position: absolute; left: 8px; top: 50%; transform: translateY(-50%);
  color: var(--text-tertiary); pointer-events: none;
}
.hist-search .search-input {
  width: 100%; height: 26px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 0 24px 0 26px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
  outline: none; transition: border-color 0.15s;
}
.hist-search .search-input:focus { border-color: var(--accent); }
.hist-search .search-input::placeholder { color: var(--text-tertiary); }
.hist-search .search-clear {
  position: absolute; right: 2px; top: 50%; transform: translateY(-50%);
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); border-radius: 50%;
}
.hist-search .search-clear:hover { background: var(--border); color: var(--text-primary); }
.hist-list { padding-bottom: 4px; }
/* 历史/收藏行通用骨架（对齐 RecentSessionList.recent-item 关键样式） */
.row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: var(--radius-sm);
  cursor: pointer; background: transparent;
  transition: background 0.15s;
}
.row:hover { background: var(--session-item-hover-bg); }
.row:active { background: var(--session-item-hover-bg); transform: scale(0.995); }
/* 星标（收藏/历史行通用）：位于标题与 project 之间，默认折叠不占位（右列 project 对齐稳定），hover 行才展开 */
.row-star {
  width: 0 !important;
  opacity: 0;
  overflow: hidden;
  flex-shrink: 0;
  margin: 0;
  transition: width .12s ease, opacity .12s ease, margin .12s ease;
}
.row:hover .row-star {
  width: 22px !important;
  opacity: 1;
  margin-right: 2px;
}
.row-agent { flex-shrink: 0; }
.row-title {
  flex: 1; min-width: 0;
  font-size: 13px; color: var(--text-primary); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.row-project {
  font-size: var(--fs-caption); color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; flex-shrink: 0;
}
.status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-tertiary); flex-shrink: 0;
}
.status-dot.running { background: var(--status-success); }
.status-dot.done { background: var(--text-tertiary); }
.status-dot.ended { background: transparent; box-shadow: inset 0 0 0 1.5px var(--text-tertiary); }
.status-dot.awaiting_permission { background: var(--status-error); }
.empty { padding: 20px; text-align: center; font-size: 12px; color: var(--text-tertiary); }
</style>
