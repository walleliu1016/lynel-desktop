import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Settings } from '../types/settings'
import { GetSettings, UpdateSettings } from '../composables/useElectron'

export const useSettingsStore = defineStore('settings', () => {
  const cfg = ref<Settings | null>(null)
  const dirty = ref(false)

  async function load() {
    cfg.value = await GetSettings()
    dirty.value = false
  }

  async function save() {
    if (!cfg.value) return
    await UpdateSettings(cfg.value)
    dirty.value = false
  }

  function markDirty() { dirty.value = true }

  return { cfg, dirty, load, save, markDirty }
})
