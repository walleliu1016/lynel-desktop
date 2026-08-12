import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { defaultTerminalConfig, type Settings, type TerminalTheme } from '../types/settings'
import { GetSettings, UpdateSettings } from '../composables/useElectron'
import { setThemeMode, themeMode, type ThemeMode } from '../composables/useTheme'

/** 终端主题跟随 UI 主题：浅色 UI 用暖色亮，深色 UI 用默认暗色 */
function terminalThemeForUI(): TerminalTheme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'default-dark' : 'warm-light'
}

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
  // 终端配色是否由用户显式设置（持久化过）。未显式设置时默认跟随 UI 主题。
  let terminalExplicit = false

  async function load() {
    const raw = (await GetSettings()) as Partial<Settings> | null
    // 兼容老版本：dark-pro / oled-dark 等旧主题已下线，允许 light/dark/system 三值，未知值回退 system
    if (raw && raw.theme !== 'light' && raw.theme !== 'dark' && raw.theme !== 'system') {
      raw.theme = 'system'
    }
    terminalExplicit = !!(raw?.terminal && typeof raw.terminal === 'object')
    const merged: Settings = { ...defaultSettings(), ...(raw || {}) }
    if (terminalExplicit) {
      // 用户显式配置过终端配色，尊重其选择
      merged.terminal = { ...defaultTerminalConfig(), ...raw!.terminal }
    } else {
      // 未自定义终端配色：跟随 UI 主题，避免浅色 UI 下出现整块黑色终端
      merged.terminal = { ...defaultTerminalConfig(), theme: terminalThemeForUI() }
    }
    cfg.value = merged
    // 从持久化设置同步主题（useTheme 负责应用与监听系统切换）
    if (cfg.value.theme) setThemeMode(cfg.value.theme as ThemeMode)
    dirty.value = false
  }

  // UI 主题切换时，未显式自定义的终端配色跟随变化
  watch(themeMode, () => {
    if (!cfg.value || terminalExplicit) return
    const t = terminalThemeForUI()
    if (cfg.value.terminal.theme !== t) {
      cfg.value.terminal = { ...cfg.value.terminal, theme: t }
    }
  })

  async function save() {
    if (!cfg.value) return
    // 用户把终端配色改成与跟随值不同时，视为显式设置，之后不再跟随 UI 主题
    if (cfg.value.terminal.theme !== terminalThemeForUI()) {
      terminalExplicit = true
    }
    // IPC 序列化需要普通对象，避免传入 Vue reactive proxy
    await UpdateSettings(JSON.parse(JSON.stringify(cfg.value)))
    dirty.value = false
  }

  function markDirty() { dirty.value = true }

  return { cfg, dirty, load, save, markDirty }
})
