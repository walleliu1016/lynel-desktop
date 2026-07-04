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
import { EventsOn, ResizeTerminal, OpenSessionTerminalSized } from '../composables/useWails'

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
  if (!terminalEl.value) return

  term = new Terminal({
    cursorBlink: false,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    allowProposedApi: true,
    minimumContrastRatio: 4.5,
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

  await nextTick()
  fitAndResize()
  requestAnimationFrame(() => fitAndResize())

  resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => fitAndResize(), 150)
  })
  resizeObserver.observe(terminalEl.value)

  term.onData((data: string) => {
    emit('data', data)
  })

  themeObserver = new MutationObserver(() => {
    if (term) syncXtermTheme(term)
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  const topic = `session:${props.sessionId}`
  cleanupEvents = EventsOn(topic, (line: string) => {
    if (line === '{"type":"done"}') return
    term?.write(line)
  })

  // 兜底：即使没有任何渲染事件，10s 后也不再卡住 loading
  fallbackTimer = setTimeout(() => revealTerminal(), 10000)

  try {
    emit('starting')
    await OpenSessionTerminalSized(props.sessionId, props.workdir, term.cols, term.rows)
  } catch (e: any) {
    revealTerminal()
    term?.writeln(`\r\n启动 Claude 失败：${e?.message || e}`)
  }
})

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

function fitAndResize() {
  if (!term || !terminalEl.value || !props.visible) return
  const width = terminalEl.value.clientWidth
  const height = terminalEl.value.clientHeight
  if (width <= 0 || height <= 0) return
  fitAddon?.fit()
  if (term.cols === lastCols && term.rows === lastRows) return
  lastCols = term.cols
  lastRows = term.rows
  ResizeTerminal(props.sessionId, term.cols, term.rows).catch(() => {})
}

watch(() => props.visible, (visible) => {
  if (!visible) return
  nextTick(() => {
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
</style>
