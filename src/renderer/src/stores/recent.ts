import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RecentSession } from '../types/recent'
import type { SessionMeta } from '../types/session'
import { GetRecentSessions, AddRecentSession, RemoveRecentSession } from '../composables/useElectron'

export const useRecentStore = defineStore('recent', () => {
  const recentSessions = ref<RecentSession[]>([])
  const loading = ref(false)

  async function loadRecentSessions() {
    loading.value = true
    try {
      const list = (await GetRecentSessions()) as RecentSession[]
      recentSessions.value = Array.isArray(list) ? list : []
    } catch (e: any) {
      console.error('[recent] load failed:', e?.message || e)
      recentSessions.value = []
    } finally {
      loading.value = false
    }
  }

  async function addRecentSession(meta: SessionMeta, state?: string) {
    const record: RecentSession = {
      sessionId: meta.id,
      workdir: meta.workdir,
      project: meta.project,
      aiTitle: meta.ai_title || '',
      firstPrompt: meta.first_prompt || '',
      lastOpenedAt: Date.now(),
      state: state || 'idle',
    }
    try {
      await AddRecentSession(record)
      await loadRecentSessions()
    } catch (e: any) {
      console.error('[recent] add failed:', e?.message || e)
    }
  }

  async function removeRecentSession(sessionId: string) {
    try {
      await RemoveRecentSession(sessionId)
      recentSessions.value = recentSessions.value.filter((r) => r.sessionId !== sessionId)
    } catch (e: any) {
      console.error('[recent] remove failed:', e?.message || e)
    }
  }

  return { recentSessions, loading, loadRecentSessions, addRecentSession, removeRecentSession }
})
