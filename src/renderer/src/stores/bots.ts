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

  async function load() {
    loading.value = true
    try {
      console.log('[bots] load start')
      const configs = (await ListBots()) as any[]
      const status = (await GetBotConnectionStatus()) as Record<string, boolean>
      console.log('[bots] load got', configs.length, 'bots')
      bots.value = configs.map(c => ({
        ...c,
        connected: status[c.id] ?? false,
      }))
      dirty.value = false
    } catch (err) {
      console.error('[bots] load failed:', err)
    } finally {
      loading.value = false
    }
  }

  async function save(bot: BotItem) {
    const { connected, ...config } = bot
    await SaveBot(config)
    dirty.value = false
    await load()
  }

  async function remove(id: string) {
    await DeleteBot(id)
    await load()
  }

  return { bots, loading, dirty, threshold, count, overThreshold, load, save, remove }
})
