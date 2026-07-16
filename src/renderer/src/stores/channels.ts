import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'
import type { ChannelInstance, ChannelsData } from '../types/channels'
import { CHANNEL_TYPES, defaultConfigForType } from '../types/channels'
import { GetChannelsConfig, UpdateChannelConfig, DeleteChannelConfig } from '../composables/useElectron'

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
    // toRaw + JSON 确保 IPC 传递的是纯对象，避免 Vue reactive Proxy 无法被 structured clone
    const raw = toRaw(data.value[id])
    const clone = JSON.parse(JSON.stringify(raw))
    await UpdateChannelConfig(id, clone)
    dirty.value = false
  }

  async function saveAll() {
    for (const id of Object.keys(data.value)) {
      const raw = toRaw(data.value[id])
      const clone = JSON.parse(JSON.stringify(raw))
      await UpdateChannelConfig(id, clone)
    }
    dirty.value = false
  }

  function markDirty() { dirty.value = true }

  function addChannel(type: string): string {
    // 同类型只能存在一份；如果已有，直接返回已有 id（避免无限累积 UUID 条目）
    const existing = list.value.find(c => c.type === type)
    if (existing) return existing.id
    const info = CHANNEL_TYPES.find(t => t.type === type)
    const id = type // key === type，与主进程 channelInstances 对齐
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

  async function removeChannel(id: string) {
    if (!data.value[id]) return
    // 先通知主进程删除（settingsStore + 重置 channel instance），
    // 再清本地 Pinia state，保证两端一致
    try {
      await DeleteChannelConfig(id)
    } catch (err) {
      // 即使主进程失败，也清本地并重新 load 以对齐
      console.error('[channels] deleteChannelConfig failed:', err)
    }
    delete data.value[id]
    dirty.value = false
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
