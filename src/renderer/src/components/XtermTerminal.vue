<template>
  <div class="terminal-shell">
    <div
      ref="terminalEl"
      class="xterm-container"
      @click="focusTerminal"
      @contextmenu.prevent="onTermCtx"
    />
    <div
      v-if="loading"
      data-testid="terminal-loading"
      class="terminal-loading"
    >
      <div ref="spinnerEl" class="spinner-static" />
      <div class="loading-text">正在启动 Claude 会话…</div>
    </div>
    <div
      v-if="exited"
      class="terminal-exited"
    >
      <div class="exited-text">Claude 进程已退出</div>
      <button class="exited-btn" @click="reconnect">重新进入</button>
    </div>
  </div>
  <Teleport to="body">
    <div v-if="ctxOpen" class="term-ctx-overlay" @click="closeTermCtx" @contextmenu.prevent="closeTermCtx">
      <div class="term-ctx-menu" :style="ctxStyle" @click.stop>
        <button v-if="hasTermSelection" class="menu-item" @click="copyTermSelection">复制</button>
        <button class="menu-item" @click="pasteTerm">粘贴</button>
        <button class="menu-item" @click="selectAllTerm">全选</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SerializeAddon } from '@xterm/addon-serialize'
import '@xterm/xterm/css/xterm.css'
import { EventsOn, ResizeTerminal, OpenSessionTerminalSized, ClipboardWrite } from '../composables/useElectron'
import { showToast } from '../composables/useToast'
import { useSettingsStore } from '../stores/settings'
import { defaultTerminalConfig, type TerminalConfig, type TerminalTheme } from '../types/settings'

const settings = useSettingsStore()

/** 一次 getComputedStyle 内读全部 xterm 主题变量，合并 22 次 layout 为 1 次 */
const THEME_VARS = [
  ['background', '--term-bg'],
  ['foreground', '--term-fg'],
  ['cursor', '--term-cursor'],
  ['selectionBackground', '--term-selection'],
  ['selectionForeground', '--term-fg'],
  ['selectionInactiveBackground', '--term-selection'],
  ['black', '--term-black'],
  ['red', '--term-red'],
  ['green', '--term-green'],
  ['yellow', '--term-yellow'],
  ['blue', '--term-blue'],
  ['magenta', '--term-magenta'],
  ['cyan', '--term-cyan'],
  ['white', '--term-white'],
  ['brightBlack', '--term-bright-black'],
  ['brightRed', '--term-bright-red'],
  ['brightGreen', '--term-bright-green'],
  ['brightYellow', '--term-bright-yellow'],
  ['brightBlue', '--term-bright-blue'],
  ['brightMagenta', '--term-bright-magenta'],
  ['brightCyan', '--term-bright-cyan'],
  ['brightWhite', '--term-bright-white'],
] as const

/**
 * 同步应用 theme：setAttribute data-term-theme + 一次 getComputedStyle 读全部 22 个变量。
 * 给 init（同步用）和 scheduleThemeSync（rAF 内用）共用，避免两处重复实现。
 */
function applyThemeSync(theme: TerminalTheme): Record<string, string> {
  document.documentElement.setAttribute('data-term-theme', theme)
  const style = getComputedStyle(document.documentElement)
  const themeObj: Record<string, string> = {}
  for (const [key, varName] of THEME_VARS) {
    themeObj[key] = style.getPropertyValue(varName).trim() || '#000'
  }
  return themeObj
}

/** 等待指定字体可用。否则 fitAddon 测出来的 char width 是回退字体的，会算出错误的 cols/rows */
async function waitForFontReady(family: string, size: number): Promise<void> {
  if (!document.fonts?.load) return
  // 解析 font-family 字符串，取第一个引号名作为优先字体
  const first = family.split(',')[0].trim().replace(/^["']|["']$/g, '')
  if (!first || first === 'monospace') return
  try {
    await document.fonts.load(`${size}px ${first}`)
  } catch {
    // 字体加载失败也不阻塞终端初始化，用回退字体也能用
  }
}

/** rAF 节流：合并同一帧内的多次 theme 同步，避免快速点击触发连续 22 次 reflow */
let pendingThemeSync: { t: Terminal; theme: TerminalTheme } | null = null
let themeSyncRaf = 0
function scheduleThemeSync(t: Terminal, theme: TerminalTheme) {
  pendingThemeSync = { t, theme }
  if (themeSyncRaf) return
  themeSyncRaf = requestAnimationFrame(() => {
    themeSyncRaf = 0
    const job = pendingThemeSync
    pendingThemeSync = null
    if (!job) return
    job.t.options.theme = applyThemeSync(job.theme) as any
    // xterm 不会自动用新 theme 重绘已有 buffer；必须显式 refresh 才能让已显示的字符换色
    job.t.refresh(0, job.t.rows - 1)
  })
}

const props = defineProps<{
  sessionId: string
  workdir: string
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'data', data: string): void
  (e: 'starting'): void
  (e: 'ready'): void
}>()

const terminalEl = ref<HTMLElement | null>(null)
const loading = ref(true)
const exited = ref(false)
const spinnerEl = ref<HTMLElement | null>(null)
let spinnerRaf = 0

function runSpinner() {
  if (!spinnerEl.value) return
  let deg = 0
  const step = () => {
    if (!spinnerEl.value) return
    deg = (deg + 6) % 360
    spinnerEl.value.style.transform = `rotate(${deg}deg)`
    spinnerRaf = requestAnimationFrame(step)
  }
  step()
}

function killSpinner() {
  if (spinnerRaf) { cancelAnimationFrame(spinnerRaf); spinnerRaf = 0 }
}

watch(loading, (v) => {
  if (v) {
    killSpinner()
    requestAnimationFrame(() => runSpinner())
  } else {
    killSpinner()
  }
})

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let serializeAddon: SerializeAddon | null = null
let cleanupFns: (() => void)[] = []
let resizeObserver: ResizeObserver | null = null
let renderDisposer: { dispose: () => void } | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let fallbackTimer: ReturnType<typeof setTimeout> | null = null
let lastCols = 0
let lastRows = 0
let ptyConnected = false

/** 上次应用的 TerminalConfig：避免 theme 切换时也跑 fit/refresh/IPC */
let lastApplied: TerminalConfig | null = null
async function applyTerminalConfig(cfg: TerminalConfig) {
  if (!term) return
  const prev = lastApplied
  // theme 走节流路径：合帧内的多次切换
  if (!prev || prev.theme !== cfg.theme) {
    scheduleThemeSync(term, cfg.theme)
  }
  // 需要触发 refit 的配置变化（影响 cell 尺寸 → cols）：
  //   - fontSize / fontFamily / lineHeight 改变
  //   - 首次进入（prev 为 null）
  const needsRefit = !prev
    || prev.fontSize !== cfg.fontSize
    || prev.lineHeight !== cfg.lineHeight
    || prev.fontFamily !== cfg.fontFamily
  // 在改字体前先把 buffer 序列化成字符串（含 FG/BG/attrs 的 ANSI 转义码）。
  // SerializeAddon 的输出规则：硬换行输出 \r\n，软换行（isWrapped=true）不输出分隔符。
  // 所以写回新 cols 的终端时，原本按旧 cols 折行的内容会被新 cols 自动重新 wrap，
  // 颜色和属性也通过 ANSI 码原样保留。这绕开了 xterm 6.0 内置 reflow 在 buffer resize 时
  // 不重排老内容的问题（实测 3/5/6.png 现象）。
  let savedSnapshot = ''
  if (needsRefit) {
    try {
      savedSnapshot = serializeAddon?.serialize() ?? ''
    } catch (err) {
      // 序列化失败不能阻塞字体切换；记日志后走无 reflow 路径
      console.warn('[XtermTerminal] SerializeAddon.serialize failed:', err)
      savedSnapshot = ''
    }
  }
  if (needsRefit) {
    // **关键顺序**：先等新字体加载完成再写 term.options，否则 xterm 的 CharSizeService
    // 同步 measure 时会拿到回退字体的 metrics，把 cell.width 锁死。
    await waitForFontReady(cfg.fontFamily, cfg.fontSize)
    if (!term) return
  }
  if (!prev || prev.fontSize !== cfg.fontSize) term.options.fontSize = cfg.fontSize
  if (!prev || prev.fontFamily !== cfg.fontFamily) term.options.fontFamily = cfg.fontFamily
  if (!prev || prev.lineHeight !== cfg.lineHeight) term.options.lineHeight = cfg.lineHeight
  if (!prev || prev.cursorStyle !== cfg.cursorStyle) term.options.cursorStyle = cfg.cursorStyle
  if (!prev || prev.cursorBlink !== cfg.cursorBlink) term.options.cursorBlink = cfg.cursorBlink
  if (!prev || prev.scrollback !== cfg.scrollback) term.options.scrollback = cfg.scrollback
  if (needsRefit) {
    // 清空老 buffer：旧 cell 已经按旧 cols 摆放，必须丢掉
    term.reset()
    // fit 重新计算 cols/rows（依赖新字体已加载）
    fitAddon?.fit()
    if (term && term.cols > 0 && term.rows > 0) {
      lastCols = term.cols
      lastRows = term.rows
      ResizeTerminal(props.sessionId, term.cols, term.rows).catch(() => {})
    }
    // 写回序列化的内容：xterm 会按新 cols 自动 wrap
    if (savedSnapshot) term.write(savedSnapshot)
  }
  lastApplied = { ...cfg }
}

const ctxOpen = ref(false)
const ctxStyle = ref({ top: '0px', left: '0px' })
const hasTermSelection = ref(false)

function focusTerminal() {
  term?.focus()
}

function onTermCtx(e: MouseEvent) {
  hasTermSelection.value = !!(term?.hasSelection())
  ctxOpen.value = true
  ctxStyle.value = { top: `${e.clientY}px`, left: `${e.clientX}px` }
}

function closeTermCtx() {
  ctxOpen.value = false
}

function copyTermSelection() {
  const text = term?.getSelection()
  if (text) {
    void ClipboardWrite(text).then(() => {
      showToast('已复制', 'success')
    }).catch(() => {
      showToast('复制失败', 'error')
    })
  }
  closeTermCtx()
}

function pasteTerm() {
  void navigator.clipboard.readText().then((text) => {
    if (text && term) {
      term.focus()
      term.paste(text)
    }
  }).catch(() => {})
  closeTermCtx()
}

function selectAllTerm() {
  term?.selectAll()
  closeTermCtx()
}

/** Ctrl + 滚轮调节终端字号 */
const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 24
const FONT_SIZE_STEP = 1
function clampFontSize(n: number): number {
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(n)))
}
function onWheel(e: WheelEvent) {
  if (!e.ctrlKey || !term || !settings.cfg) return
  e.preventDefault()
  e.stopPropagation()
  const cur = settings.cfg.terminal.fontSize
  const next = clampFontSize(cur + (e.deltaY < 0 ? FONT_SIZE_STEP : -FONT_SIZE_STEP))
  if (next === cur) return
  settings.cfg.terminal.fontSize = next
  settings.markDirty()
  applyTerminalConfig(settings.cfg.terminal)
  showToast(`字号 ${next}px`, 'success')
}

async function reconnect() {
  if (!terminalEl.value || !props.visible) return
  for (const fn of cleanupFns) try { fn() } catch {}
  cleanupFns = []
  resizeObserver?.disconnect()
  renderDisposer?.dispose()
  serializeAddon?.dispose()
  term?.dispose()
  term = null
  fitAddon = null
  serializeAddon = null
  resizeObserver = null
  renderDisposer = null
  lastCols = 0
  lastRows = 0
  lastApplied = null
  exited.value = false
  loading.value = true
  ptyConnected = false
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
  if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null }
  await initializeTerminal()
}

onMounted(async () => {
  if (!terminalEl.value || !props.visible) return
  if (!settings.cfg) await settings.load()
  await initializeTerminal()
})

async function initializeTerminal() {
  if (term || !terminalEl.value) return
  if (!settings.cfg) await settings.load()

  await waitForSize()

  const termCfg = settings.cfg?.terminal ?? defaultTerminalConfig()
  // 同步应用 theme：让 Terminal 创建时就拿到正确的颜色对象，避免首帧闪烁或颜色错误
  const themeObj = applyThemeSync(termCfg.theme)
  // 等待配置的字体加载完成再创建 Terminal，否则 fitAddon 测出来的 char 尺寸是回退字体的
  await waitForFontReady(termCfg.fontFamily, termCfg.fontSize)
  if (!terminalEl.value) return
  term = new Terminal({
    cursorBlink: termCfg.cursorBlink,
    cursorStyle: termCfg.cursorStyle,
    fontSize: termCfg.fontSize,
    fontFamily: termCfg.fontFamily,
    lineHeight: termCfg.lineHeight,
    allowProposedApi: true,
    minimumContrastRatio: 4.5,
    scrollback: termCfg.scrollback,
    theme: themeObj as any,
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())
  // SerializeAddon：用于字体/字号切换时把老 buffer（含 ANSI 颜色）序列化出来，
  // reset + 重写时由新 cols 自动重新 wrap。
  serializeAddon = new SerializeAddon()
  term.loadAddon(serializeAddon)

  term.open(terminalEl.value)

  // 强制 xterm renderer 用新字体重测 char size，避免 fit 拿到旧 metrics 算出错的 cols
  ;(term as any)._core?._renderService?.onCharSizeChanged?.()
  // 等待浏览器完成布局，让 xterm 的 char size 测量和 IntersectionObserver 生效
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await new Promise((resolve) => requestAnimationFrame(resolve))

  // Ctrl+滚轮调字号：挂在容器上即可
  terminalEl.value.addEventListener('wheel', onWheel, { passive: false })
  cleanupFns.push(() => terminalEl.value?.removeEventListener('wheel', onWheel))

  renderDisposer = term.onRender(() => {
    if (!loading.value) return
    if (!ptyConnected) return
    if (bufferHasVisibleContent()) revealTerminal()
  })

  term.onData((data: string) => {
    emit('data', data)
  })

  // 监听 settings.terminal 变化（用户从设置面板修改时实时应用到 xterm）
  cleanupFns.push(watch(
    () => settings.cfg?.terminal,
    (cfg) => { if (cfg && term) applyTerminalConfig(cfg) },
    { deep: true },
  ))

  resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => fitAndResize(), 150)
  })
  resizeObserver.observe(terminalEl.value)

  const topic = `session:${props.sessionId}`
  cleanupFns.push(EventsOn(topic, (line: string) => {
    if (line === '{"type":"done"}') {
      loading.value = false
      exited.value = true
      return
    }
    term?.write(line)
  }))

  // fallback 真正兜底：30s 内无可见内容则强制 reveal
  fallbackTimer = setTimeout(() => revealTerminal(), 30000)

  try {
    emit('starting')
    await fitWithRetry()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    forceViewportSync()
    const ptyExisted = await OpenSessionTerminalSized(props.sessionId, props.workdir, term.cols, term.rows)
    ptyConnected = true

    // 强制刷新以触发 onRender（此时 ptyConnected 已为 true，可以正确检查 buffer）
    await new Promise((resolve) => requestAnimationFrame(resolve))
    term?.refresh(0, term.rows - 1)

    if (ptyExisted) {
      // 重连已有 PTY：新 xterm buffer 为空，PTY 可能空闲无新输出
      // 缩短 fallback 到 5s，onRender 会在数据到达时自动 reveal
      if (fallbackTimer) {
        clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
      fallbackTimer = setTimeout(() => revealTerminal(), 5000)
    } else {
      // 新建 PTY：IPC 期间可能已有数据写入 xterm，主动检查 buffer
      if (bufferHasVisibleContent()) revealTerminal()
    }
  } catch (e: any) {
    revealTerminal()
    term?.writeln(`\r\n启动 Claude 失败：${e?.message || e}`)
  }
}

async function fitWithRetry(maxAttempts = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    if (fitAndResize()) return
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  throw new Error('无法获得有效的终端尺寸')
}

function bufferHasVisibleContent(): boolean {
  if (!term) return false
  const buffer = term.buffer.active
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i)
    if (line && line.translateToString(true).trim().length > 0) {
      return true
    }
  }
  return false
}

function revealTerminal() {
  if (!loading.value) return
  loading.value = false
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
  emit('ready')
}

function waitForSize(): Promise<void> {
  return new Promise((resolve) => {
    const el = terminalEl.value
    if (!el) return resolve()
    let lastW = 0
    let lastH = 0
    let stable = 0
    function check() {
      if (!terminalEl.value) return resolve()
      const w = terminalEl.value.clientWidth
      const h = terminalEl.value.clientHeight
      if (w > 0 && h > 0) {
        if (w === lastW && h === lastH) {
          stable++
          // 连续 3 帧尺寸不变 → 布局已稳定
          if (stable >= 3) return resolve()
        } else {
          stable = 0
          lastW = w
          lastH = h
        }
      }
      requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  })
}

function fitAndResize(): boolean {
  if (!term || !terminalEl.value || !props.visible) return false
  const width = terminalEl.value.clientWidth
  const height = terminalEl.value.clientHeight
  if (width <= 0 || height <= 0) return false
  fitAddon?.fit()
  if (term.cols === 0 || term.rows === 0) return false
  term.refresh(0, term.rows - 1)
  if (term.cols === lastCols && term.rows === lastRows) return true
  lastCols = term.cols
  lastRows = term.rows
  ResizeTerminal(props.sessionId, term.cols, term.rows).catch(() => {})
  return true
}

// 直接调用 xterm.js 内部的 viewport._sync()，强制刷新滚动条尺寸。
// 这是最可靠的修复：绕过 ResizeObserver/FitAddon 的尺寸变化检测。
function forceViewportSync(): void {
  if (!term) return
  const core = (term as any)._core
  const viewport = core?.viewport
  if (viewport) {
    viewport._latestYDisp = undefined
    viewport._sync()
  }
}

watch(() => props.visible, (visible) => {
  if (!visible) return
  nextTick(async () => {
    if (!term) {
      await initializeTerminal()
      return
    }
    // 等待 IntersectionObserver 触发，让 xterm.js renderer 退出暂停状态
    await new Promise((resolve) => requestAnimationFrame(resolve))
    // 等容器恢复到非零尺寸，避免 fit() 用 0 尺寸破坏 viewport
    await waitForSize()
    lastCols = 0
    lastRows = 0
    fitAddon?.fit()
    if (term && terminalEl.value && term.cols > 0 && term.rows > 0) {
      term.refresh(0, term.rows - 1)
      lastCols = term.cols
      lastRows = term.rows
      ResizeTerminal(props.sessionId, term.cols, term.rows).catch(() => {})
    }
    // 等待浏览器完成布局后再强制刷新 viewport 滚动条
    await new Promise((resolve) => requestAnimationFrame(resolve))
    forceViewportSync()
    term?.focus()
  })
})

onBeforeUnmount(() => {
  killSpinner()
  for (const fn of cleanupFns) try { fn() } catch {}
  cleanupFns = []
  resizeObserver?.disconnect()
  renderDisposer?.dispose()
  serializeAddon?.dispose()
  term?.dispose()
  term = null
  fitAddon = null
  serializeAddon = null
  resizeObserver = null
  renderDisposer = null
  lastCols = 0
  lastRows = 0
  ptyConnected = false
  lastApplied = null
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = null
  }
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
})
</script>

<style scoped>
.terminal-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.xterm-container {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.terminal-loading {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
  background: var(--bg-terminal-loading);
  pointer-events: none;
}

.loading-text {
  font-size: 12px;
}

.terminal-exited {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
  background: var(--bg-terminal-loading);
}

.exited-text {
  font-size: 14px;
  font-weight: 500;
}

.exited-btn {
  padding: 8px 24px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
}
.exited-btn:hover { background: var(--accent-deep); }

.xterm-container :deep(.xterm-viewport)::-webkit-scrollbar {
  width: 8px;
}
.xterm-container :deep(.xterm-viewport)::-webkit-scrollbar-track {
  background: var(--scrollbar-track);
}
.xterm-container :deep(.xterm-viewport)::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 4px;
}
.xterm-container :deep(.xterm-viewport)::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
</style>

<style>
.spinner-static {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
}

.term-ctx-overlay { position: fixed; inset: 0; z-index: 999; }
.term-ctx-menu {
  position: fixed; z-index: 1000;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-panel);
  padding: 4px; min-width: 100px;
}
.term-ctx-menu .menu-item {
  display: block; width: 100%; text-align: left;
  padding: 6px 10px; border-radius: var(--radius-sm);
  font-size: 12px; color: var(--text-primary);
  background: transparent; border: none; cursor: pointer;
}
.term-ctx-menu .menu-item:hover { background: var(--session-item-hover-bg); }
</style>
