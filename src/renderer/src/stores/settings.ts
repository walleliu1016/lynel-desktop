import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Settings } from '../types/settings'
import { GetSettings, UpdateSettings } from '../composables/useElectron'

function defaultSettings(): Settings {
  return {
    theme: 'light-pro',
    claude_path: '',
    auto_allow_bash: false,
    log_enabled: false,
    auto_lock_minutes: 5,
    auto_start: false,
    minimize_on_start: false,
    notch_enabled: false,
    cloud_service_enabled: false,
    cloud_service_url: '',
    cloud_service_token: '',
    push_thinking: false,
    push_tool_calls: false,
    prevent_sleep: false,
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const cfg = ref<Settings | null>(null)
  const dirty = ref(false)

  async function load() {
    const raw = (await GetSettings()) as Partial<Settings> | null
    // OLED 暗色主题已下线，迁移到默认浅色主题
    if (raw && (raw.theme as string) === 'oled-dark') {
      raw.theme = 'light-pro'
    }
    cfg.value = { ...defaultSettings(), ...(raw || {}) }
    dirty.value = false
  }

  async function save() {
    if (!cfg.value) return
    // IPC 序列化需要普通对象，避免传入 Vue reactive proxy
    await UpdateSettings(JSON.parse(JSON.stringify(cfg.value)))
    dirty.value = false
  }

  function markDirty() { dirty.value = true }

  return { cfg, dirty, load, save, markDirty }
})
