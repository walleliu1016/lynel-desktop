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

function focusTerminal() {
  term?.focus()
}

onMounted(async () => {
  if (!terminalEl.value) return

  term = new Terminal({
    cursorBlink: false,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
    allowProposedApi: true,
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())

  term.open(terminalEl.value)

  await nextTick()
  fitAndResize()
  requestAnimationFrame(() => fitAndResize())

  resizeObserver = new ResizeObserver(() => {
    fitAndResize()
  })
  resizeObserver.observe(terminalEl.value)

  term.onData((data: string) => {
    emit('data', data)
  })

  const topic = `session:${props.sessionId}`
  cleanupEvents = EventsOn(topic, (line: string) => {
    if (line === '{"type":"done"}') return
    loading.value = false
    emit('ready')
    term?.write(line)
  })

  try {
    emit('starting')
    await OpenSessionTerminalSized(props.sessionId, props.workdir, term.cols, term.rows)
  } catch (e: any) {
    loading.value = false
    emit('ready')
    term?.writeln(`\r\n启动 Claude 失败：${e?.message || e}`)
  }
})

function fitAndResize() {
  if (!term || !terminalEl.value || !props.visible) return
  const width = terminalEl.value.clientWidth
  const height = terminalEl.value.clientHeight
  if (width <= 0 || height <= 0) return
  fitAddon?.fit()
  ResizeTerminal(props.sessionId, term.cols, term.rows).catch(() => {})
}

function emitResize() {
  fitAndResize()
}

watch(() => props.visible, (visible) => {
  if (!visible) return
  nextTick(() => {
    fitAndResize()
    requestAnimationFrame(() => fitAndResize())
    term?.focus()
  })
})

watch(() => props.sessionId, () => {
  cleanupEvents?.()
  term?.dispose()
})

onBeforeUnmount(() => {
  cleanupEvents?.()
  resizeObserver?.disconnect()
  term?.dispose()
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
  background: #1e1e1e;
  pointer-events: none;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(255, 255, 255, 0.18);
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
