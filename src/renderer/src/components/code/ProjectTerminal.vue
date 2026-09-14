<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import Icon from '../Icon.vue'
import {
  EventsOn,
  ShellEnsure,
  ShellWrite,
  ShellResize,
} from '../../composables/useElectron'
import { useSettingsStore } from '../../stores/settings'
import { defaultTerminalConfig } from '../../types/settings'
import { applyThemeSync, waitForFontReady, scheduleThemeSync } from '../../terminal/theme'

const props = defineProps<{
  sessionId: string
  workDir: string
  visible: boolean
}>()

const settings = useSettingsStore()
const hostEl = ref<HTMLElement | null>(null)
const exited = ref(false)
const errorMsg = ref('')

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let cleanups: (() => void)[] = []
let lastCols = 0
let lastRows = 0

function disposeTerm() {
  for (const fn of cleanups) {
    try { fn() } catch { /* 忽略 */ }
  }
  cleanups = []
  resizeObserver?.disconnect()
  resizeObserver = null
  term?.dispose()
  term = null
  fitAddon = null
  lastCols = 0
  lastRows = 0
  if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null }
}

function fitAndResize() {
  if (!term || !hostEl.value || !props.visible) return
  if (hostEl.value.clientWidth <= 0 || hostEl.value.clientHeight <= 0) return
  fitAddon?.fit()
  if (term.cols === 0 || term.rows === 0) return
  term.refresh(0, term.rows - 1)
  if (term.cols === lastCols && term.rows === lastRows) return
  lastCols = term.cols
  lastRows = term.rows
  void ShellResize(props.sessionId, term.cols, term.rows).catch(() => {})
}

async function init() {
  if (term || !hostEl.value) return
  if (!settings.cfg) await settings.load()

  const cfg = settings.cfg?.terminal ?? defaultTerminalConfig()
  // 创建 Terminal 前同步应用 theme，避免首帧颜色错误
  const themeObj = applyThemeSync(cfg.theme)
  await waitForFontReady(cfg.fontFamily, cfg.fontSize)
  if (!hostEl.value) return

  term = new Terminal({
    cursorBlink: cfg.cursorBlink,
    cursorStyle: cfg.cursorStyle,
    cursorWidth: 2,
    fontSize: cfg.fontSize,
    fontFamily: cfg.fontFamily,
    lineHeight: cfg.lineHeight,
    allowProposedApi: true,
    scrollback: cfg.scrollback,
    theme: themeObj as any,
  })
  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(hostEl.value)

  // 等两帧布局，让 xterm 的 char size 测量稳定后再 fit
  await new Promise((r) => requestAnimationFrame(r))
  await new Promise((r) => requestAnimationFrame(r))
  fitAddon.fit()

  term.onData((data: string) => {
    void ShellWrite(props.sessionId, data).catch(() => {})
  })

  cleanups.push(EventsOn(`shell:${props.sessionId}`, (data: string) => term?.write(data)))
  cleanups.push(EventsOn(`shell:exit:${props.sessionId}`, () => { exited.value = true }))

  // 主题跟随设置变化
  cleanups.push(watch(
    () => settings.cfg?.terminal.theme,
    (t) => { if (term && t) scheduleThemeSync(term, t) },
  ))

  resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(fitAndResize, 150)
  })
  resizeObserver.observe(hostEl.value)

  const res = await ShellEnsure(props.sessionId, props.workDir, term.cols, term.rows)
  if (!res.ok) {
    errorMsg.value = res.error ?? '启动终端失败'
    return
  }
  if (res.replay) term.write(res.replay)
  term.focus()
}

async function restart() {
  if (!term) return
  exited.value = false
  errorMsg.value = ''
  term.reset()
  const res = await ShellEnsure(props.sessionId, props.workDir, term.cols, term.rows)
  if (!res.ok) {
    errorMsg.value = res.error ?? '启动终端失败'
    return
  }
  if (res.replay) term.write(res.replay)
  term.focus()
}

// 会话切换：重建 xterm（PTY 保留在主进程，靠 replay 回放）
watch(() => props.sessionId, async () => {
  disposeTerm()
  exited.value = false
  errorMsg.value = ''
  await nextTick()
  await init()
})

// 面板/标签重新可见：容器尺寸可能已变，补一次 fit
watch(() => props.visible, async (v) => {
  if (!v) return
  await nextTick()
  await new Promise((r) => requestAnimationFrame(r))
  fitAndResize()
  term?.focus()
})

onMounted(async () => {
  await nextTick()
  await init()
})

onBeforeUnmount(() => {
  // 只销毁前端实例；PTY 由主进程按会话生命周期管理，重开时靠 replay 回放
  disposeTerm()
})
</script>

<template>
  <div class="project-terminal">
    <div ref="hostEl" class="term-host" />
    <div v-if="errorMsg" class="term-mask">
      <div class="mask-text">{{ errorMsg }}</div>
      <button class="mask-btn" @click="restart">重试</button>
    </div>
    <div v-else-if="exited" class="term-mask">
      <div class="mask-text">终端进程已退出</div>
      <button class="mask-btn" @click="restart">
        <Icon name="rotate-ccw" :size="13" /> 重新启动
      </button>
    </div>
  </div>
</template>

<style scoped>
.project-terminal {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.term-host {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.term-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  background: var(--term-bg);
}
.mask-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid var(--code-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--fs-caption);
  cursor: pointer;
}
.mask-btn:hover { background: var(--code-hover); }
.term-host :deep(.xterm-viewport)::-webkit-scrollbar { width: 8px; }
.term-host :deep(.xterm-viewport)::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 4px;
}
</style>
