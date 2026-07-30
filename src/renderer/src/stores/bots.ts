import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { BotItem } from '../types/bots'
import { ListBots, SaveBot, DeleteBot, GetBotConnectionStatus } from '../composables/useElectron'

export const useBotsStore = defineStore('bots', () => {
  const bots = ref<BotItem[]>([])
  const loading = ref(false)
  const dirty = ref(false)
  const threshold = ref(5)

  const count = computed(() => bots.value.length)
  const overThreshold = computed(() => count.value >= threshold.value)

  // 已加载/加载中去重：SessionItem 等组件挂载时都会调 load，避免 N 个实例 = N 次重复 IPC
  let loaded = false
  let loadingPromise: Promise<void> | null = null

  async function load(force = false) {
    if (loadingPromise) return loadingPromise
    if (loaded && !force) return
    loading.value = true
    loadingPromise = (async () => {
      try {
        const configs = (await ListBots()) as any[]
        const status = (await GetBotConnectionStatus()) as Record<string, boolean>
        bots.value = configs.map(c => ({
          ...c,
          connected: status[c.id] ?? false,
        }))
        dirty.value = false
        loaded = true
      } catch (err) {
        console.error('[bots] load failed:', err)
      } finally {
        loading.value = false
        loadingPromise = null
      }
    })()
    return loadingPromise
  }

  async function save(bot: BotItem) {
    const { connected, ...config } = bot
    await SaveBot(config)
    dirty.value = false
    await load(true)
  }

  async function remove(id: string) {
    await DeleteBot(id)
    await load(true)
  }

  return { bots, loading, dirty, threshold, count, overThreshold, load, save, remove }
})
