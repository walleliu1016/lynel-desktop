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
import '@xterm/xterm/css/xterm.css'
import { EventsOn, ResizeTerminal, OpenSessionTerminalSized } from '../composables/useElectron'
import { showToast } from '../composables/useToast'

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000'
}

function syncXtermTheme(t: Terminal) {
  t.options.theme = {
    background: cssVar('--bg-terminal'),
    foreground: cssVar('--text-primary'),
    cursor: cssVar('--accent'),
    selectionBackground: cssVar('--accent-soft-bg'),
    selectionForeground: cssVar('--text-primary'),
  }
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
let cleanupEvents: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let renderDisposer: { dispose: () => void } | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let fallbackTimer: ReturnType<typeof setTimeout> | null = null
let lastCols = 0
let lastRows = 0

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
    void navigator.clipboard.writeText(text).then(() => {
      showToast('已复制', 'success')
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

async function reconnect() {
  if (!terminalEl.value || !props.visible) return
  cleanupEvents?.()
  resizeObserver?.disconnect()
  renderDisposer?.dispose()
  term?.dispose()
  term = null
  fitAddon = null
  cleanupEvents = null
  resizeObserver = null
  renderDisposer = null
  lastCols = 0
  lastRows = 0
  exited.value = false
  loading.value = true
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
  if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null }
  await initializeTerminal()
}

onMounted(async () => {
  if (!terminalEl.value || !props.visible) return
  await initializeTerminal()
})

async function initializeTerminal() {
  if (term || !terminalEl.value) return

  await waitForSize()

  term = new Terminal({
    cursorBlink: false,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    allowProposedApi: true,
    minimumContrastRatio: 4.5,
    scrollback: 1000,
  })
  syncXtermTheme(term)

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())

  term.open(terminalEl.value)

  // 等待浏览器完成布局，让 xterm 的 char size 测量和 IntersectionObserver 生效
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await new Promise((resolve) => requestAnimationFrame(resolve))

  renderDisposer = term.onRender(() => {
    if (!loading.value) return
    if (bufferHasVisibleContent()) revealTerminal()
  })

  term.onData((data: string) => {
    emit('data', data)
  })

  themeObserver = new MutationObserver(() => {
    if (term) syncXtermTheme(term)
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => fitAndResize(), 150)
  })
  resizeObserver.observe(terminalEl.value)

  const topic = `session:${props.sessionId}`
  cleanupEvents = EventsOn(topic, (line: string) => {
    if (line === '{"type":"done"}') {
      loading.value = false
      exited.value = true
      return
    }
    term?.write(line)
  })

  fallbackTimer = setTimeout(() => revealTerminal(), 10000)

  try {
    emit('starting')
    await fitWithRetry()
    // 强制刷新 viewport 滚动条
    await new Promise((resolve) => requestAnimationFrame(resolve))
    forceViewportSync()
    await OpenSessionTerminalSized(props.sessionId, props.workdir, term.cols, term.rows)
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
    if (line && line.translateToString(true).length > 0) {
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
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return resolve()

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr && cr.width > 0 && cr.height > 0) {
        ro.disconnect()
        resolve()
      }
    })
    ro.observe(el)
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
    // 否则 fit() 时 _isPaused 仍为 true，canvas resize 被延迟，导致 viewport 滚动条尺寸不正确
    await new Promise((resolve) => requestAnimationFrame(resolve))
    // 等容器恢复实际尺寸后再 fit，避免 0 尺寸损坏 viewport 滚动状态
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
    // 强制刷新 viewport 滚动条
    await new Promise((resolve) => requestAnimationFrame(resolve))
    forceViewportSync()
    term?.focus()
  })
})

onBeforeUnmount(() => {
  killSpinner()
  cleanupEvents?.()
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  renderDisposer?.dispose()
  term?.dispose()
  term = null
  fitAddon = null
  cleanupEvents = null
  resizeObserver = null
  renderDisposer = null
  lastCols = 0
  lastRows = 0
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

.xterm-container :deep(.xterm-cursor),
.xterm-container :deep(.xterm-cursor-layer) {
  display: none !important;
}
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
