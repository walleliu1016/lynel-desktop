import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RecentSession } from '../types/recent'
import type { SessionMeta } from '../types/session'
import { GetFavorites, AddFavorite, RemoveFavorite } from '../composables/useElectron'

export interface FavoriteSession extends RecentSession {
  favoritedAt: number
}

/** SessionMeta → RecentSession（加星/打开复用；字段名对齐 recent） */
export function toFavorite(meta: SessionMeta): RecentSession {
  return {
    sessionId: meta.id,
    workdir: meta.workdir,
    project: meta.project,
    aiTitle: meta.ai_title || '',
    firstPrompt: meta.first_prompt || '',
    lastOpenedAt: (meta.mtime || 0) * 1000,
    state: 'idle',
    userTitle: meta.user_title,
    agent: meta.agent,
  }
}

export const useFavoritesStore = defineStore('favorites', () => {
  const favorites = ref<FavoriteSession[]>([])
  const loading = ref(false)

  async function loadFavorites() {
    loading.value = true
    try {
      const list = (await GetFavorites()) as FavoriteSessionRecordLike[]
      favorites.value = Array.isArray(list) ? list.map((r) => toFavoriteSession(r)) : []
    } catch (e: any) {
      console.error('[favorites] load failed:', e?.message || e)
      favorites.value = []
    } finally {
      loading.value = false
    }
  }

  async function addFavorite(meta: RecentSession) {
    if (isFavorite(meta.sessionId)) return
    const record: FavoriteSession = { ...meta, favoritedAt: Date.now() }
    try {
      await AddFavorite(record)
      favorites.value = [...favorites.value, record]
    } catch (e: any) {
      console.error('[favorites] add failed:', e?.message || e)
      throw e
    }
  }

  async function removeFavorite(sessionId: string) {
    try {
      await RemoveFavorite(sessionId)
      favorites.value = favorites.value.filter((r) => r.sessionId !== sessionId)
    } catch (e: any) {
      console.error('[favorites] remove failed:', e?.message || e)
      throw e
    }
  }

  function isFavorite(sessionId: string): boolean {
    return favorites.value.some((r) => r.sessionId === sessionId)
  }

  function toRecent(sessionId: string): RecentSession | null {
    const r = favorites.value.find((f) => f.sessionId === sessionId)
    if (!r) return null
    return { ...r, lastOpenedAt: r.favoritedAt, state: 'idle' }
  }

  return { favorites, loading, loadFavorites, addFavorite, removeFavorite, isFavorite, toRecent }
})

// 与主进程 FavoriteSessionRecord 结构对齐；标题/顺序已由主进程合并 recents
interface FavoriteSessionRecordLike {
  sessionId: string
  workdir: string
  project: string
  userTitle?: string
  aiTitle?: string
  firstPrompt?: string
  agent?: string
  favoritedAt: number
}

function toFavoriteSession(r: FavoriteSessionRecordLike): FavoriteSession {
  return {
    sessionId: r.sessionId,
    workdir: r.workdir,
    project: r.project,
    aiTitle: r.aiTitle || '',
    firstPrompt: r.firstPrompt || '',
    lastOpenedAt: r.favoritedAt,
    favoritedAt: r.favoritedAt,
    state: 'idle',
    userTitle: r.userTitle,
    agent: r.agent,
  }
}
