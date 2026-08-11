import { defineStore } from 'pinia'
import { ref } from 'vue'
import { defaultTerminalConfig, type Settings } from '../types/settings'
import { GetSettings, UpdateSettings } from '../composables/useElectron'
import { setThemeMode, type ThemeMode } from '../composables/useTheme'

function defaultSettings(): Settings {
  return {
    theme: 'system',
    claude_path: '',
    codex_path: '',
    opencode_path: '',
    omp_path: '',
    auto_allow_bash: false,
    log_enabled: false,
    auto_lock_minutes: 5,
    auto_start: false,
    minimize_on_start: false,
    cloud_service_enabled: false,
    cloud_service_url: '',
    push_thinking: false,
    push_tool_calls: false,
    prevent_sleep: false,
    terminal: defaultTerminalConfig(),
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const cfg = ref<Settings | null>(null)
  const dirty = ref(false)

  async function load() {
    const raw = (await GetSettings()) as Partial<Settings> | null
    // 兼容老版本：dark-pro / oled-dark 等旧主题已下线，允许 light/dark/system 三值，未知值回退 system
    if (raw && raw.theme !== 'light' && raw.theme !== 'dark' && raw.theme !== 'system') {
      raw.theme = 'system'
    }
    const merged: Settings = { ...defaultSettings(), ...(raw || {}) }
    // 兼容老版本：缺 terminal 字段时填默认
    if (!raw?.terminal || typeof raw.terminal !== 'object') {
      merged.terminal = defaultTerminalConfig()
    } else {
      merged.terminal = { ...defaultTerminalConfig(), ...raw.terminal }
    }
    cfg.value = merged
    // 从持久化设置同步主题（useTheme 负责应用与监听系统切换）
    if (cfg.value.theme) setThemeMode(cfg.value.theme as ThemeMode)
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
