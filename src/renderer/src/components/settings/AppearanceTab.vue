<template>
  <div class="appearance-tab">
    <h2>外观</h2>

    <div class="actions">
      <div class="spacer" />
      <button class="btn-cancel" :disabled="!settings.dirty" @click="settings.load">取消</button>
      <button class="btn-save" :disabled="!settings.dirty" @click="onSave">保存</button>
    </div>

    <!-- 终端配色 -->
    <section class="section">
      <div class="section-title">终端配色</div>
      <div class="theme-grid">
        <button
          v-for="opt in terminalThemes"
          :key="opt.id"
          class="theme-card"
          :class="{ active: cfg.theme === opt.id }"
          @click="setTermTheme(opt.id)"
        >
          <div class="theme-preview" :style="previewStyle(opt.id)">
            <div class="preview-bar" />
            <div class="preview-ansi">
              <span v-for="(c, i) in 16" :key="i" :style="{ background: ansiColor(opt.id, i) }" />
            </div>
            <div class="preview-text">
              <span :style="{ color: ansiColor(opt.id, 7) }">~/dev</span>
              <span :style="{ color: ansiColor(opt.id, 2) }"> $</span>
              <span :style="{ color: ansiColor(opt.id, 7) }"> ls</span>
            </div>
          </div>
          <div class="theme-name">{{ opt.name }}</div>
        </button>
      </div>
      <p class="form-hint">仅影响 xterm 终端窗口；UI 主题不受影响。</p>
    </section>

    <!-- 字体 -->
    <section class="section">
      <div class="section-title">字体</div>
      <div class="form-group">
        <label class="form-label">字体族</label>
        <select class="form-select" v-model="cfg.fontFamily" @change="markDirty">
          <option v-for="f in fontPresets" :key="f.value" :value="f.value">{{ f.label }}</option>
        </select>
        <p class="form-hint">首选字体在系统未安装时自动回退到等宽备选。</p>
      </div>

      <div class="form-group">
        <label class="form-label">
          字号
          <span class="form-value">{{ cfg.fontSize }}px</span>
        </label>
        <input
          type="range"
          min="10"
          max="24"
          step="1"
          v-model.number="cfg.fontSize"
          @input="onFontSizeInput"
        />
        <p class="form-hint">或在终端内按 <kbd>Ctrl</kbd> + <kbd>滚轮</kbd> 实时调节（10-24）。</p>
      </div>

      <div class="form-group">
        <label class="form-label">
          行高
          <span class="form-value">{{ cfg.lineHeight.toFixed(2) }}</span>
        </label>
        <input
          type="range"
          min="1"
          max="2"
          step="0.05"
          v-model.number="cfg.lineHeight"
          @input="markDirty"
        />
      </div>
    </section>

    <!-- 光标 -->
    <section class="section">
      <div class="section-title">光标</div>
      <div class="form-group">
        <label class="form-label">光标样式</label>
        <div class="seg-group">
          <button
            v-for="s in cursorStyles"
            :key="s.value"
            class="seg"
            :class="{ active: cfg.cursorStyle === s.value }"
            @click="setCursorStyle(s.value)"
          >
            {{ s.label }}
          </button>
        </div>
      </div>

      <div class="form-group">
        <label class="switch-row">
          <span class="switch-label">光标闪烁</span>
          <Switch v-model="cfg.cursorBlink" @change="markDirty" />
        </label>
      </div>
    </section>

    <!-- 行为 -->
    <section class="section">
      <div class="section-title">行为</div>
      <div class="form-group">
        <label class="form-label">
          回滚行数
          <span class="form-value">{{ cfg.scrollback }}</span>
        </label>
        <select class="form-select" v-model.number="cfg.scrollback" @change="markDirty">
          <option :value="500">500</option>
          <option :value="1000">1,000</option>
          <option :value="5000">5,000</option>
          <option :value="10000">10,000</option>
        </select>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import Switch from '../Switch.vue'
import { useSettingsStore } from '../../stores/settings'
import { defaultTerminalConfig, type TerminalConfig, type TerminalTheme, type TerminalCursorStyle } from '../../types/settings'
import { showToast } from '../../composables/useToast'

const settings = useSettingsStore()
/**
 * 本地 ref 镜像 store.terminal。v-model 写到本地 ref，再通过显式 sync() 同步到 store。
 * 不用双向 watch 避免循环触发。store 重新 load（取消按钮）时从外部重新同步到本地。
 */
const cfg = ref<TerminalConfig>(defaultTerminalConfig())
/** 防止 watch 回环 */
let syncing = false

function syncToStore() {
  if (!settings.cfg || syncing) return
  settings.cfg.terminal = { ...cfg.value }
  settings.markDirty()
}

onMounted(async () => {
  if (!settings.cfg) await settings.load()
  if (settings.cfg) {
    syncing = true
    cfg.value = { ...settings.cfg.terminal }
    syncing = false
  }
})

// store 重新 load（取消按钮）时同步回本地
watch(() => settings.cfg?.terminal, (t) => {
  if (!t) return
  syncing = true
  cfg.value = { ...t }
  syncing = false
}, { deep: true })

function markDirty() {
  // 本地 cfg 任何字段变化都推到 store，XtermTerminal 的 watch 才能实时应用到 xterm
  syncToStore()
}

const terminalThemes: { id: TerminalTheme; name: string }[] = [
  { id: 'default-dark', name: '默认暗色' },
  { id: 'solarized-dark', name: 'Solarized 暗' },
  { id: 'one-half-dark', name: 'One Half 暗' },
  { id: 'gruvbox-dark', name: 'Gruvbox 暗' },
  { id: 'monokai', name: 'Monokai' },
  { id: 'dracula', name: 'Dracula' },
  { id: 'solarized-light', name: 'Solarized 亮' },
  { id: 'warm-light', name: '暖色亮' },
]

const fontPresets: { value: string; label: string }[] = [
  { value: '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Courier New", monospace', label: 'JetBrains Mono' },
  { value: '"Fira Code", "JetBrains Mono", Consolas, monospace', label: 'Fira Code' },
  { value: '"SF Mono", Menlo, Consolas, "Courier New", monospace', label: 'SF Mono / Menlo' },
  { value: '"Cascadia Code", "JetBrains Mono", Consolas, monospace', label: 'Cascadia Code' },
  { value: 'Consolas, "Courier New", monospace', label: 'Consolas' },
  { value: 'Menlo, Consolas, monospace', label: 'Menlo' },
  { value: '"Source Code Pro", "JetBrains Mono", monospace', label: 'Source Code Pro' },
]

const cursorStyles: { value: TerminalCursorStyle; label: string }[] = [
  { value: 'block', label: '块' },
  { value: 'underline', label: '下划线' },
  { value: 'bar', label: '竖线' },
]

/**
 * 8 套主题的预览色（与 styles/theme.css 同步）。
 * 渲染期直接读静态数组，**不切换 data-term-theme**，避免 render 期间频繁 reflow。
 * 实际 xterm 颜色仍由 theme.css 决定，XtermTerminal 在挂载时一次性读取。
 */
const PREVIEW: Record<TerminalTheme, { bg: string; fg: string; ansi: string[] }> = {
  'default-dark':   { bg: '#1e1e1e', fg: '#d4d4d4', ansi: ['#000000','#cd3131','#0dbc79','#e5e510','#2472c8','#bc3fbc','#11a8cd','#e5e5e5','#666666','#f14c4c','#23d18b','#f5f543','#3b8eea','#d670d6','#29b8db','#ffffff'] },
  'solarized-dark': { bg: '#002b36', fg: '#93a1a1', ansi: ['#073642','#dc322f','#859900','#b58900','#268bd2','#d33682','#2aa198','#eee8d5','#586e75','#cb4b16','#586e75','#657b83','#839496','#6c71c4','#93a1a1','#fdf6e3'] },
  'one-half-dark':  { bg: '#282c34', fg: '#dcdae2', ansi: ['#282c34','#e06c75','#98c379','#e5c07b','#61afef','#c678dd','#56b6c2','#dcdae2','#5c6370','#e06c75','#98c379','#e5c07b','#61afef','#c678dd','#56b6c2','#ffffff'] },
  'gruvbox-dark':   { bg: '#282828', fg: '#ebdbb2', ansi: ['#282828','#cc241d','#98971a','#d79921','#458588','#b16286','#689d6a','#a89984','#928374','#fb4934','#b8bb26','#fabd2f','#83a598','#d3869b','#8ec07c','#ebdbb2'] },
  'monokai':        { bg: '#272822', fg: '#f8f8f2', ansi: ['#272822','#f92672','#a6e22e','#f4bf75','#66d9ef','#ae81ff','#a1efe4','#f8f8f2','#75715e','#f92672','#a6e22e','#f4bf75','#66d9ef','#ae81ff','#a1efe4','#f9f8f5'] },
  'dracula':        { bg: '#282a36', fg: '#f8f8f2', ansi: ['#21222c','#ff5555','#50fa7b','#f1fa8c','#bd93f9','#ff79c6','#8be9fd','#f8f8f2','#6272a4','#ff6e6e','#69ff94','#ffffa5','#d6acff','#ff92df','#a4ffff','#ffffff'] },
  'solarized-light':{ bg: '#fdf6e3', fg: '#586e75', ansi: ['#073642','#dc322f','#859900','#b58900','#268bd2','#d33682','#2aa198','#eee8d5','#586e75','#cb4b16','#586e75','#657b83','#839496','#6c71c4','#93a1a1','#fdf6e3'] },
  'warm-light':     { bg: '#F2EBD9', fg: '#1F1A12', ansi: ['#1F1A12','#B5302A','#2F6B3A','#B58105','#2A6FB0','#8B3D8B','#1F7A8C','#6B5D44','#6B5D44','#D0413A','#3F8A4D','#D89A1F','#3D85C2','#A853A8','#2A95AA','#1F1A12'] },
}

function ansiColor(id: TerminalTheme, idx: number): string {
  return PREVIEW[id].ansi[idx] ?? '#888'
}

function previewStyle(id: TerminalTheme) {
  return { background: PREVIEW[id].bg, color: PREVIEW[id].fg }
}

function setTermTheme(id: TerminalTheme) {
  cfg.value.theme = id
  // 不直接改 data-term-theme：XtermTerminal.vue 的 watch(settings.cfg.terminal) 链路
  // 会在 syncXtermTheme 内统一 setAttribute，避免与 MutationObserver 双触发。
  syncToStore()
}

function setCursorStyle(s: TerminalCursorStyle) {
  cfg.value.cursorStyle = s
  syncToStore()
}

/** 字号拖动时 markDirty 即可；watcher 会实时应用到 xterm */
function onFontSizeInput() {
  markDirty()
}

async function onSave() {
  try {
    await settings.save()
    showToast('保存成功')
  } catch (e: any) {
    showToast('保存失败：' + (e?.message ?? e), 'error')
  }
}
</script>

<style scoped>
.appearance-tab { padding: 20px 24px; max-width: 720px; }
h2 { font-size: 16px; color: var(--text-primary); font-weight: 600; margin-bottom: 8px; }

.section { margin-top: 24px; }
.section-title {
  font-size: 12px; font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.04em;
  margin-bottom: 10px;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.theme-card {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, transform 0.1s;
}
.theme-card:hover { border-color: var(--accent-soft-border); }
.theme-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.theme-preview {
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.3;
  display: flex; flex-direction: column; gap: 4px;
  overflow: hidden;
}
.preview-bar {
  display: flex; gap: 3px;
  margin-bottom: 2px;
}
.preview-bar::before,
.preview-bar::after,
.preview-bar {
  height: 4px; border-radius: 1px;
}
.preview-bar::before { content: ''; flex: 0 0 18px; background: currentColor; opacity: 0.3; }
.preview-bar::after  { content: ''; flex: 0 0 8px;  background: currentColor; opacity: 0.3; }
.preview-ansi {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 1px;
  height: 8px;
}
.preview-ansi span { display: block; }
.preview-text {
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}
.theme-name {
  font-size: 12px;
  color: var(--text-primary);
  text-align: center;
  padding: 2px 0;
}

.form-group { margin-bottom: 16px; }
.form-label {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500;
}
.form-value {
  font-family: var(--font-mono);
  color: var(--text-primary);
  font-size: 12px;
}
.form-select, .form-input {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: 13px; font-family: inherit;
}
.form-select:focus, .form-input:focus { outline: none; border-color: var(--accent); }
.form-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }
.form-hint kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 5px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
}

input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
}

.seg-group {
  display: inline-flex;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 2px;
  gap: 2px;
}
.seg {
  padding: 5px 14px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.seg:hover { color: var(--text-primary); }
.seg.active {
  background: var(--accent-soft-bg);
  color: var(--accent-light);
  font-weight: 500;
}

.switch-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: var(--radius-md); cursor: pointer;
}
.switch-row:hover { background: var(--bg-input); }
.switch-label { font-size: 13px; color: var(--text-primary); }

.actions {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border);
}
.spacer { flex: 1; }
.btn-save { padding: 7px 20px; background: var(--accent); color: white; border: none; border-radius: var(--radius-md); font-size: 12px; font-weight: 500; cursor: pointer; }
.btn-save:hover:not(:disabled) { background: var(--accent-deep); }
.btn-cancel { padding: 7px 16px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }
.btn-cancel:hover:not(:disabled) { background: var(--border); }
.btn-save:disabled, .btn-cancel:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
