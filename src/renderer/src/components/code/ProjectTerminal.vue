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

// init() 可重入保护：切会话时旧 init 可能仍挂在 await 上，用 generation 让它作废
let initGen = 0

function disposeTerm() {
  initGen++
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
  // addon-fit 的下限是 2x1，不会是 0；这里拦的是折叠动画中途的退化尺寸
  if (term.cols < 20 || term.rows < 5) return
  term.refresh(0, term.rows - 1)
  if (term.cols === lastCols && term.rows === lastRows) return
  lastCols = term.cols
  lastRows = term.rows
  void ShellResize(props.sessionId, term.cols, term.rows).catch(() => {})
}

/** 取当前终端尺寸。容器极小时 fit 会算出 2x1 这类退化尺寸（addon-fit 内部下限是 2/1，
 *  不会是 0），用有意义的下限兜底；容器展开后由 ResizeObserver 触发 ShellResize 修正。 */
function safeTermSize(): { cols: number; rows: number } {
  const cols = term && term.cols >= 20 ? term.cols : 80
  const rows = term && term.rows >= 5 ? term.rows : 24
  return { cols, rows }
}

async function init() {
  if (!props.sessionId || term || !hostEl.value) return
  // 一次性可见闸门：CodeView 在会话 tab 期间常挂载，面板也可能折叠或停在非终端
  // 子页，此时不该白白 spawn 一个 shell 进程。不可见就返回，等 props.visible 变真
  // 时由 visible watcher 补 init（故 sessionId watcher 在不可见时也会安全空转）。
  if (!props.visible) return
  const gen = ++initGen
  if (!settings.cfg) await settings.load()
  if (gen !== initGen) return

  const cfg = settings.cfg?.terminal ?? defaultTerminalConfig()
  // 创建 Terminal 前同步应用 theme，避免首帧颜色错误
  const themeObj = applyThemeSync(cfg.theme)
  await waitForFontReady(cfg.fontFamily, cfg.fontSize)
  if (gen !== initGen || !hostEl.value) return

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
  if (gen !== initGen) return
  await new Promise((r) => requestAnimationFrame(r))
  if (gen !== initGen) return

  // 折叠态/隐藏态挂载时容器尺寸为 0，fit 会得出 0 列行，不能拿去启动 PTY；
  // 此时跳过 fit，用下面的默认尺寸兜底，展开后由 visible watcher + ResizeObserver 修正
  const host = hostEl.value
  if (host && host.clientWidth > 0 && host.clientHeight > 0) {
    fitAddon.fit()
  }

  // 固定当前实例，避免 await 期间模块级 term 被后来的 init() 改写
  const t = term
  const sid = props.sessionId

  t.onData((data: string) => {
    void ShellWrite(sid, data).catch(() => {})
  })

  // 订阅先于 ShellEnsure 是必须的（否则快照时刻到订阅时刻之间的输出会丢），
  // 但直接写会和 replay 快照重复；所以先入队，拿到快照后再按序落地。
  const pending: string[] = []
  let replayDone = false
  cleanups.push(EventsOn(`shell:${sid}`, (data: string) => {
    if (replayDone) t.write(data)
    else pending.push(data)
  }))
  cleanups.push(EventsOn(`shell:exit:${sid}`, () => { exited.value = true }))

  // 主题跟随设置变化
  cleanups.push(watch(
    () => settings.cfg?.terminal.theme,
    (th) => { if (th) scheduleThemeSync(t, th) },
  ))

  resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(fitAndResize, 150)
  })
  resizeObserver.observe(hostEl.value)

  const size = safeTermSize()
  const res = await ShellEnsure(sid, props.workDir, size.cols, size.rows)
  if (gen !== initGen) return
  if (!res.ok) {
    errorMsg.value = res.error ?? '启动终端失败'
    return
  }
  if (res.replay) t.write(res.replay)
  replayDone = true
  for (const chunk of pending) t.write(chunk)
  pending.length = 0
  t.focus()
}

async function restart() {
  if (!props.sessionId || !term) return
  exited.value = false
  errorMsg.value = ''
  const t = term
  t.reset()
  const size = safeTermSize()
  const res = await ShellEnsure(props.sessionId, props.workDir, size.cols, size.rows)
  if (!res.ok) {
    errorMsg.value = res.error ?? '启动终端失败'
    return
  }
  if (res.replay) t.write(res.replay)
  t.focus()
}

// 会话切换：重建 xterm（PTY 保留在主进程，靠 replay 回放）
watch(() => props.sessionId, async () => {
  disposeTerm()
  exited.value = false
  errorMsg.value = ''
  await nextTick()
  await init()
})

// 面板/标签重新可见：容器尺寸可能已变，补一次 fit；若此前因不可见未启动，这里补 init
watch(() => props.visible, async (v) => {
  if (!v) return
  await nextTick()
  if (!term) {
    await init()
    return
  }
  await new Promise((r) => requestAnimationFrame(r))
  fitAndResize()
  term?.focus()
})

onMounted(async () => {
  await nextTick()
  // 不可见时不启动：终端面板可能只是被挂载（CodeView 在会话 tab 期间常挂载、
  // 或面板处于折叠/非终端标签态），此时不该白白 spawn 一个 shell 进程。
  if (!props.visible) return
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
