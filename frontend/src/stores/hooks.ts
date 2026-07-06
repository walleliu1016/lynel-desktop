import { defineStore } from 'pinia'
import { ref } from 'vue'
import { GetHooksConfig, SaveHooksConfig } from '../composables/useElectron'

export const useHooksStore = defineStore('hooks', () => {
  const cfg = ref<Record<string, any> | null>(null)
  const dirty = ref(false)

  async function load() {
    cfg.value = await GetHooksConfig()
    dirty.value = false
  }

  async function save() {
    if (!cfg.value) return
    await SaveHooksConfig(cfg.value)
    dirty.value = false
  }

  function markDirty() { dirty.value = true }

  return { cfg, dirty, load, save, markDirty }
})
