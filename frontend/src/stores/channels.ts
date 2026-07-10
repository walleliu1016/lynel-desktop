import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ChannelInstance, ChannelsData } from '../types/channels'
import { CHANNEL_TYPES, defaultConfigForType } from '../types/channels'
import { GetChannelsConfig, UpdateChannelConfig } from '../composables/useElectron'

export const useChannelsStore = defineStore('channels', () => {
  const data = ref<ChannelsData>({})
  const dirty = ref(false)

  const list = computed(() => Object.values(data.value))
  const activeId = computed(() => list.value.find(c => c.enabled)?.id ?? '')

  async function load() {
    try {
      const raw = (await GetChannelsConfig()) as ChannelsData | null
      data.value = raw || {}
      dirty.value = false
    } catch {}
  }

  async function save(id: string) {
    if (!data.value[id]) return
    await UpdateChannelConfig(id, { ...data.value[id] })
    dirty.value = false
  }

  async function saveAll() {
    for (const id of Object.keys(data.value)) {
      await UpdateChannelConfig(id, { ...data.value[id] })
    }
    dirty.value = false
  }

  function markDirty() { dirty.value = true }

  function addChannel(type: string): string {
    const id = crypto.randomUUID()
    const info = CHANNEL_TYPES.find(t => t.type === type)
    data.value[id] = {
      id,
      type,
      name: info?.name ?? type,
      enabled: false,
      config: defaultConfigForType(type),
    }
    dirty.value = true
    return id
  }

  function removeChannel(id: string) {
    delete data.value[id]
    dirty.value = true
  }

  async function setActive(id: string) {
    if (!data.value[id]) return
    // 互斥：关闭其他所有通道
    for (const c of list.value) {
      data.value[c.id] = { ...data.value[c.id], enabled: c.id === id }
    }
    dirty.value = true
    await saveAll()
  }

  return { data, list, activeId, dirty, load, save, saveAll, markDirty, addChannel, removeChannel, setActive }
})
