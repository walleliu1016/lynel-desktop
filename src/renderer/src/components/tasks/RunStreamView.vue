<!-- 运行流水：把一次 run 的完整 stream-json 事件流重放成人能读的线性视图。
     结构照设计稿第 3 / 4 节：头部 → 按元素显隐开关 → 状态栏 → 事件体。
     - 工具调用折叠成一行 StepCard（Edit / Write 例外，diff 是任务产出）
     - 思考 / 诊断输出默认折叠（空诊断输出直接给一行静态文案，不留展开后什么都没有的折叠块）
     - running 时底部自动跟随；用户手动上滚即停止跟随，滚回底部恢复
     事件折叠逻辑在 utils/tasks.ts 的 flattenRunEvents，本组件只负责渲染与开关。 -->
<template>
  <div class="stream">
    <div class="shd">
      <span class="bk" @click="$emit('close')">
        <Icon name="chevron-left" :size="14" />{{ taskLabel }}
      </span>
      <span class="dim">/</span>
      <span class="ttl">{{ startedText }} 的运行</span>
    </div>

    <!-- 按元素显隐开关（照 @fnclaude/renderer 的做法，切换即时重绘） -->
    <div class="toggles">
      <span class="tg" :class="{ on: show.thinking }" @click="show.thinking = !show.thinking">思考</span>
      <span class="tg" :class="{ on: show.input }" @click="show.input = !show.input">工具入参</span>
      <span class="tg" :class="{ on: show.output }" @click="show.output = !show.output">工具输出</span>
      <span class="tg" :class="{ on: show.errorsOnly }" @click="show.errorsOnly = !show.errorsOnly">仅错误</span>
      <span class="sp" />
      <span class="cnt">{{ events.length }} 条事件 · {{ toolCount }} 个工具调用 · {{ errorCount }} 个失败</span>
    </div>

    <div class="sbar" :class="barTone">
      <Icon :name="barIcon" :size="14" :class="'st-' + run.status" />
      <span class="big" :class="'st-' + run.status">{{ barLabel }}</span>
      <span class="muted">{{ barMeta }}</span>
      <span v-if="run.status === 'running'" class="push">
        <button class="btn" @click="$emit('cancel')">取消</button>
      </span>
    </div>

    <div ref="bodyEl" class="sbody" @scroll="onScroll">
      <!-- key 里必须带 run.id：RunStreamView 换 run 时是同一个组件实例，只按 at 做 key 会让
           Vue 复用同下标的 ToolStepCard 实例，ToolStepCard 的 open 初值（Edit/Write 才展开）
           就再也不会对新 run 的同下标元素重新求值 —— 折叠态会跨 run 串。
           at 这一段不能去掉：折叠态是按「在未过滤列表里的下标」记的稳定标识。 -->
      <template v-for="item in items" :key="run.id + ':' + item.at">
        <div v-if="item.kind === 'init'" class="meta-line">
          <span>Claude Code {{ item.version }}</span>
          <span class="dim">·</span>
          <span>{{ item.model }}</span>
          <span class="dim">·</span>
          <span class="mono">{{ shortCwd(item.cwd) }}</span>
          <span class="dim">·</span>
          <span>{{ item.toolCount }} 个工具</span>
          <span v-for="m in item.failedMcpServers" :key="m" class="warnchip">
            <Icon name="warning" :size="12" />MCP {{ m }} 连接失败
          </span>
        </div>

        <!-- hook_started / hook_response：降级成一行，不展开 -->
        <div v-else-if="item.kind === 'hook'" class="hooked">
          <Icon name="hook" :size="12" />
          {{ item.name }} · {{ item.ok ? '成功' : '失败' }}
        </div>

        <div v-else-if="item.kind === 'thinking'" class="fold-block">
          <div class="fold" @click="toggleFold(item.at)">
            <Icon :name="expanded.has(item.at) ? 'chevron-down' : 'chevron-right'" :size="12" />思考
          </div>
          <div v-if="expanded.has(item.at)" class="md-text">{{ item.text }}</div>
        </div>

        <Markdown v-else-if="item.kind === 'text'" :text="item.text" class="md-text" />

        <!-- 子代理（parent_tool_use_id 非 null → StreamItem.subagent）缩进成一组。
             不加标题：StreamItem 只带布尔标志、没有子代理类型，任何名字都是编造的。
             非子代理的 tool 走下一分支，DOM 与改动前逐字一致。 -->
        <div v-else-if="item.kind === 'tool' && item.subagent" class="subagent">
          <ToolStepCard
            :item="item"
            :hide-input="!show.input"
            :hide-output="!show.output"
          />
        </div>

        <ToolStepCard
          v-else-if="item.kind === 'tool'"
          :item="item"
          :hide-input="!show.input"
          :hide-output="!show.output"
        />

        <div v-else-if="item.kind === 'stderr'" class="fold-block">
          <div v-if="item.text" class="fold" @click="toggleFold(item.at)">
            <Icon :name="expanded.has(item.at) ? 'chevron-down' : 'chevron-right'" :size="12" />诊断输出
          </div>
          <!-- 空的 stderr 是真实存在的一类事件：给一行静态文案，别给展开后什么都没有的把手 -->
          <div v-else class="fold readonly">诊断输出（空）</div>
          <div v-if="item.text && expanded.has(item.at)" class="io"><pre>{{ item.text }}</pre></div>
        </div>

        <div v-else-if="item.kind === 'result'" class="res" :class="{ err: item.summary.isError }">
          <div class="rh">
            <Icon
              :name="item.summary.isError ? 'warning' : 'check'"
              :size="14"
              :class="item.summary.isError ? 'st-error' : 'st-done'"
            />
            <span class="big" :class="item.summary.isError ? 'st-error' : 'st-done'">
              {{ item.summary.isError ? '失败' : '成功' }}
            </span>
            <span>
              {{ item.summary.numTurns }} 轮 · {{ formatDuration(item.summary.durationMs) }} ·
              ${{ item.summary.totalCostUsd.toFixed(3) }}
              <template v-if="item.summary.stopReason">· stop_reason={{ item.summary.stopReason }}</template>
            </span>
            <span v-if="usageChips(item.summary.usage)" class="chip">{{ usageChips(item.summary.usage) }}</span>
          </div>
          <div class="rt">{{ item.summary.resultText || '（无输出）' }}</div>
        </div>
      </template>

      <div v-if="run.status === 'running'" class="follow-caret"><span class="caret" /></div>
      <!-- 有事件但被开关滤空时不能报「还没有事件」，那会和顶部的计数自相矛盾 -->
      <div v-if="items.length === 0" class="empty">
        {{ all.length === 0 ? '这次运行还没有事件' : '当前开关下没有可显示的事件' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import Markdown from '../trace/Markdown.vue'
import ToolStepCard from './ToolStepCard.vue'
import { flattenRunEvents, formatDuration } from '../../utils/tasks'
import type { EventEnvelope, RunDto, StreamItem } from '../../types/tasks'

const props = defineProps<{
  run: RunDto
  events: EventEnvelope[]
  taskLabel?: string
}>()
defineEmits<{ (e: 'cancel'): void; (e: 'close'): void }>()

const show = ref({ thinking: true, input: false, output: true, errorsOnly: false })
/** 手动展开过的下标（思考 / 诊断输出默认折叠 —— 只有展开态需要记） */
const expanded = ref<Set<number>>(new Set())
const bodyEl = ref<HTMLElement | null>(null)
let following = true

const all = computed(() => flattenRunEvents(props.events))

/** 折叠态按「在 all 里的下标」记，不能用过滤后的下标：开关一关，
 *  下标整体前移，展开态会串到别的块上。at 随事件追加只增不改，是稳定标识。 */
const items = computed<(StreamItem & { at: number })[]>(() => {
  let list = all.value.map((item, at) => ({ ...item, at }))
  if (!show.value.thinking) list = list.filter((i) => i.kind !== 'thinking')
  // 「仅错误」= 只留失败项：失败的工具卡 + 失败的终局卡片，其余（成功的工具卡、正文、
  // 思考、init、hook、stderr）一律滤掉。留着成功的终局卡片会把答案显出来，与标签语义不符。
  if (show.value.errorsOnly) {
    list = list.filter((i) =>
      i.kind === 'tool' ? i.status === 'error' : i.kind === 'result' ? i.summary.isError : false,
    )
  }
  return list
})

const toolCount = computed(() => all.value.filter((i) => i.kind === 'tool').length)
const errorCount = computed(
  () => all.value.filter((i) => i.kind === 'tool' && i.status === 'error').length,
)

const isBad = computed(() => ['error', 'timeout', 'interrupted'].includes(props.run.status))
const LABELS: Record<string, string> = {
  queued: '排队中', running: '运行中', done: '成功', error: '失败',
  timeout: '超时', skipped: '已跳过', interrupted: '已中断',
}
const ICONS: Record<string, string> = {
  queued: 'clock', running: 'loader', done: 'check', error: 'warning',
  timeout: 'clock', skipped: 'slash', interrupted: 'slash',
}
const barLabel = computed(() => LABELS[props.run.status] ?? props.run.status)
const barIcon = computed(() => ICONS[props.run.status] ?? 'clock')
/** 状态栏底色：done 绿 / 失败红 / running 蓝（accent）/ 排队·跳过 中性。
 *  设计稿只画了成功与运行中两种；queued / skipped 沿用成功绿会读成「跑成功了」，故单独降为中性底。 */
const barTone = computed(() => {
  if (props.run.status === 'running') return 'live'
  if (isBad.value) return 'err'
  return props.run.status === 'done' ? 'done' : 'idle'
})

const startedText = computed(() => {
  const ms = props.run.startedAt ?? props.run.queuedAt
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

/* running 时显示的是「实时秒数」：computed 不会因为时间流逝自己重算，得有个秒级心跳。 */
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

function syncTicker() {
  if (props.run.status === 'running' && ticker === null) {
    ticker = setInterval(() => { now.value = Date.now() }, 1000)
  } else if (props.run.status !== 'running' && ticker !== null) {
    clearInterval(ticker)
    ticker = null
  }
}

const barMeta = computed(() => {
  const bits: string[] = []
  if (props.run.status === 'running' && props.run.startedAt != null) {
    bits.push(`已 ${formatDuration(now.value - props.run.startedAt)}`)
  } else if (props.run.durationMs != null) {
    bits.push(formatDuration(props.run.durationMs))
  }
  if (props.run.numTurns != null) bits.push(`${props.run.numTurns} 轮`)
  if (props.run.totalCostUsd != null) bits.push(`$${props.run.totalCostUsd.toFixed(3)}`)
  if (props.run.resultSubtype && props.run.status === 'error') bits.push(props.run.resultSubtype)
  if (props.run.resumeUsed === 0) bits.push('会话已重建')
  return bits.join(' · ')
})

function toggleFold(at: number) {
  const next = new Set(expanded.value)
  if (next.has(at)) next.delete(at)
  else next.add(at)
  expanded.value = next
}

function shortCwd(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…\\${parts.slice(-2).join('\\')}` : cwd
}

function usageChips(usage: Record<string, number>): string {
  const LABELS: Record<string, string> = {
    input_tokens: 'in', output_tokens: 'out',
    cache_read_input_tokens: 'cache_read', cache_creation_input_tokens: 'cache_write',
  }
  return Object.entries(usage)
    .map(([k, v]) => `${LABELS[k] ?? k} ${v.toLocaleString()}`)
    .join(' · ')
}

async function scrollToBottom() {
  await nextTick()
  const el = bodyEl.value
  if (el) el.scrollTop = el.scrollHeight
}

function onScroll() {
  const el = bodyEl.value
  if (!el) return
  following = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

/** 换 run 要重置视图态：展开态的下标是随 run 变的，跟着跨 run 会串到别的块上。 */
watch(
  () => props.run.id,
  () => {
    expanded.value = new Set()
    now.value = Date.now()
    // 正在跑的 run 跟到底（看最新）；已结束的历史 run 从顶部开始读
    following = props.run.status === 'running'
    if (following) void scrollToBottom()
  },
  { immediate: true },
)

watch(() => props.run.status, syncTicker, { immediate: true })

watch(
  () => props.events.length,
  () => {
    if (!following) return
    void scrollToBottom()
  },
)

onBeforeUnmount(() => {
  if (ticker !== null) clearInterval(ticker)
})
</script>

<style scoped>
.stream { display: flex; flex-direction: column; background: var(--bg-primary); margin-top: 14px; }
.shd {
  padding: 10px 16px; display: flex; align-items: center; gap: 10px;
  border-bottom: 1px solid var(--border); background: var(--bg-panel);
  font-size: var(--fs-caption); color: var(--text-secondary);
}
.shd .bk { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.shd .bk:hover { color: var(--text-primary); }
.shd .ttl { color: var(--text-primary); font-size: var(--fs-body-sm); }
.dim { color: var(--text-tertiary); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

.toggles {
  display: flex; gap: 6px; align-items: center; padding: 7px 16px;
  border-bottom: 1px solid var(--border); background: var(--bg-panel);
}
.tg {
  padding: 3px 10px; border-radius: var(--radius-pill);
  border: 1px solid var(--border); font-size: 11px; cursor: pointer;
  color: var(--text-secondary); background: var(--bg-card);
}
.tg:hover { background: var(--bg-hover); }
.tg.on {
  background: var(--accent-soft-bg); border-color: var(--accent-soft-border);
  color: var(--accent); font-weight: 500;
}
.toggles .sp { flex: 1; }
.toggles .cnt { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; }

.sbar {
  padding: 9px 16px; display: flex; align-items: center; gap: 10px;
  font-size: var(--fs-caption); border-bottom: 1px solid var(--border);
}
.sbar.done { background: var(--status-success-soft); }
.sbar.err { background: var(--status-error-soft); }
.sbar.live { background: var(--accent-soft-bg); }
.sbar.idle { background: var(--bg-panel); }
.sbar .big { font-weight: 600; font-size: var(--fs-body-sm); }
.sbar .muted { color: var(--text-secondary); }
.sbar .push { margin-left: auto; }

/* 事件体：自身带滚动条，底部自动跟随才有落点（外层 .dbody 也是滚动容器，
   不封住高度的话滚动条归外层，scrollTop 赋值无效、onScroll 也永远不触发）。 */
.sbody { padding: 16px 20px; max-height: 60vh; overflow-y: auto; }

.meta-line {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: var(--fs-caption); color: var(--text-tertiary); margin-bottom: 5px;
}
.meta-line .warnchip { color: var(--status-warn); display: inline-flex; align-items: center; gap: 4px; }
.hooked {
  font-size: var(--fs-caption); color: var(--text-tertiary);
  display: flex; align-items: center; gap: 6px; margin-bottom: 16px; opacity: .8;
}

.fold-block { display: block; }
.fold {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  font-size: var(--fs-caption); color: var(--text-secondary);
  padding: 4px 0; margin: 2px 0;
}
.fold:hover { color: var(--text-primary); }
.fold.readonly { cursor: default; }
.fold.readonly:hover { color: var(--text-secondary); }
.md-text { font-size: var(--fs-body-sm); margin: 10px 0 14px; }

.io {
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 8px 10px;
}
.io pre {
  margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
  color: var(--text-primary);
}

/* 子代理（parent_tool_use_id 非 null）缩进：左侧留白 + 虚竖线，照设计稿第 3 节的 .subagent */
.subagent {
  margin-left: 20px; border-left: 2px dashed var(--border-strong);
  padding-left: 12px; margin-top: 10px; margin-bottom: 10px;
}

.res {
  border: 1px solid var(--status-success); border-radius: var(--radius-md);
  background: var(--status-success-soft); padding: 12px 14px; margin-top: 18px;
}
.res.err { border-color: var(--status-error); background: var(--status-error-soft); }
.res .rh {
  display: flex; align-items: center; gap: 10px; font-size: var(--fs-caption);
  color: var(--text-secondary); margin-bottom: 8px; flex-wrap: wrap;
}
.res .rh .big { font-weight: 600; font-size: var(--fs-body-sm); }
.res .rt { font-size: var(--fs-body-sm); color: var(--text-primary); }
.chip {
  font-size: 10px; padding: 2px 7px; border-radius: var(--radius-pill);
  background: var(--bg-hover); color: var(--text-secondary);
}

.follow-caret { padding: 2px 0; }
.caret {
  display: inline-block; width: 7px; height: 14px;
  background: var(--accent); vertical-align: -2px; margin-left: 2px;
}
.empty { padding: 18px 12px; text-align: center; color: var(--text-tertiary); }

.st-done { color: var(--status-success); }
.st-error, .st-timeout { color: var(--status-error); }
.st-running { color: var(--accent); }
.st-queued, .st-skipped, .st-interrupted { color: var(--text-tertiary); }

/* 与 TaskList / TaskDetailPane 同款的按钮（.btn 不是全局类） */
.btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px;
  border-radius: var(--radius-sm); font-size: var(--fs-caption);
  border: 1px solid var(--border); background: var(--bg-card);
  color: var(--text-secondary); cursor: pointer; font-family: inherit;
}
.btn:hover { background: var(--bg-hover); }
</style>
