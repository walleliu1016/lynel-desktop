<template>
  <div class="terminal-shell">
    <div
      ref="terminalEl"
      class="xterm-container"
      @click="focusTerminal"
    />
    <div
      v-if="loading"
      data-testid="terminal-loading"
      class="terminal-loading"
    >
      <div class="spinner" />
      <div class="loading-text">正在启动 Claude 会话…</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { EventsOn, ResizeTerminal, OpenSessionTerminalSized } from '../composables/useElectron'

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

function focusTerminal() {
  term?.focus()
}

onMounted(async () => {
  if (!terminalEl.value || !props.visible) return
  await initializeTerminal()
})

async function initializeTerminal() {
  if (term || !terminalEl.value) return

  // 等容器真正在布局中占据空间后再初始化 xterm，避免 0 尺寸导致字符测量异常
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

  // 等 xterm 真正画出可见内容再隐藏 loading，避免 spinner 提前消失后留白
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
    if (line === '{"type":"done"}') return
    term?.write(line)
  })

  // 兜底：即使没有任何渲染事件，10s 后也不再卡住 loading
  fallbackTimer = setTimeout(() => revealTerminal(), 10000)

  try {
    emit('starting')
    await fitWithRetry()
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

watch(() => props.visible, (visible) => {
  if (!visible) return
  nextTick(async () => {
    if (!term) {
      // 之前因 v-show=false 未初始化，现在可见了再初始化
      await initializeTerminal()
      return
    }
    // 从 v-show=false 切回时，xterm 需要重新 fit 才能正确渲染
    lastCols = 0
    lastRows = 0
    fitAndResize()
    requestAnimationFrame(() => fitAndResize())
    term?.focus()
  })
})

onBeforeUnmount(() => {
  cleanupEvents?.()
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  renderDisposer?.dispose()
  term?.dispose()
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

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-text {
  font-size: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.xterm-container :deep(.xterm-cursor),
.xterm-container :deep(.xterm-cursor-layer) {
  display: none !important;
}
.xterm-container :deep(.xterm-viewport)::-webkit-scrollbar {
  width: 8px;
  display: block !important;
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
/* 隐藏 xterm.js 叠加滚动条，避免遮挡原生滚动条 */
.xterm-container :deep(.xterm-scrollable-element > .scrollbar) {
  display: none !important;
}
</style>
