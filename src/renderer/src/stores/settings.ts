import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { defaultTerminalConfig, defaultCodeConfig, type Settings, type TerminalTheme } from '../types/settings'
import { GetSettings, UpdateSettings } from '../composables/useElectron'
import type { AgentKind } from '../types/agents'
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
    codex_enabled: false,
    opencode_enabled: false,
    omp_enabled: false,
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
    code: defaultCodeConfig(),
    buddyEnabled: false,
    buddyRoleId: 'duck',
    buddyEye: '·',
    buddyHat: 'none',
    buddyShiny: false,
    buddyRarity: null,
    buddy3DTilt: 8,
    buddyFloatAmp: 3,
    buddyCustomAscii: '',
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const cfg = ref<Settings | null>(null)
  const dirty = ref(false)
  // 终端配色是否由用户显式设置（持久化过）。未显式设置时默认跟随 UI 主题。
  let terminalExplicit = false
  // 即改即存防抖定时器：连续改动只落盘一次
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  async function load() {
    const raw = (await GetSettings()) as Partial<Settings> | null
    // 兼容老版本：dark-pro / oled-dark 等旧主题已下线，允许 light/dark/system 三值，未知值回退 system
    if (raw && raw.theme !== 'light' && raw.theme !== 'dark' && raw.theme !== 'system') {
      raw.theme = 'system'
    }
    terminalExplicit = !!(raw?.terminal && typeof raw.terminal === 'object')
    const merged: Settings = { ...defaultSettings(), ...(raw || {}) }
    // 兼容旧版本：code 缺省时回退默认
    merged.code = { ...defaultCodeConfig(), ...(raw?.code || {}) }
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

  /** 即改即存：标记改动并防抖落盘，避免高频输入（滑块/拖拽）打爆 IPC */
  function markDirty() {
    dirty.value = true
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      save().catch((e) => console.error('[settings] 自动保存失败:', e))
    }, 500)
  }

  /** 可用 agent 列表：claude 恒在 + 开关开启者；cfg 未加载时仅 ['claude'] */
  const enabledAgentKinds = computed<AgentKind[]>(() => {
    const out: AgentKind[] = ['claude']
    const c = cfg.value
    if (!c) return out
    if (c.codex_enabled) out.push('codex')
    if (c.opencode_enabled) out.push('opencode')
    if (c.omp_enabled) out.push('omp')
    return out
  })

  /** 某 agent 是否启用：claude 恒 true；cfg 未加载时 false */
  function isAgentEnabled(kind: AgentKind): boolean {
    if (kind === 'claude') return true
    const c = cfg.value
    if (!c) return false
    return !!c[`${kind}_enabled` as 'codex_enabled' | 'opencode_enabled' | 'omp_enabled']
  }

  return { cfg, dirty, load, save, markDirty, enabledAgentKinds, isAgentEnabled }
})
