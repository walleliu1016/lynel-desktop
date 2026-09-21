<!-- 运行历史：时间轴而不是平铺列表 —— 节点 + 连接线表达「一串运行」的序列感。
     从 TaskDetailPane 里拆出来，收在工具栏「历史」按钮的浮窗里（compact 模式更窄）。
     点某一行 = 切换正文展示的那次运行，浮窗由父组件负责收起。 -->
<template>
  <div>
    <div v-if="runs.length" class="tl" :class="{ compact }">
      <div
        v-for="r in runs"
        :key="r.id"
        class="tlrow"
        :class="{ sel: r.id === activeRunId }"
        tabindex="0"
        role="button"
        @click="$emit('open', r.id)"
        @keydown.enter="$emit('open', r.id)"
      >
        <span class="node" :class="nodeTone(r.status)" />
        <span class="when">{{ absText(r) }}</span>
        <span class="pill" :class="r.status">
          <Icon :name="statusIcon(r.status)" :size="11" />{{ statusLabel(r.status) }}
        </span>
        <span v-if="!compact" class="tg">{{ r.trigger === 'manual' ? '手动' : '自动' }}</span>
        <span class="ms">{{ runSummaryText(r.resultText, r.error, r.status) }}</span>
        <span class="mt">{{ metaText(r) }}</span>
        <Icon name="chevron-right" :size="12" class="ar" />
      </div>
    </div>

    <div v-else class="blank" style="min-height: 240px">
      <div class="ic"><Icon name="history" :size="20" /></div>
      <h4>还没有运行记录</h4>
      <p>任务跑过之后，每次运行的完整流水都会留在这里。</p>
    </div>

    <div v-if="hasMore" class="more">
      <button class="btn" @click="$emit('load-more')">加载更早的运行记录</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '../Icon.vue'
import { formatDuration, runSummaryText } from '../../utils/tasks'
import { statusIcon, statusLabel } from '../../utils/taskStatus'
import type { RunDto } from '../../types/tasks'

defineProps<{
  runs: RunDto[]
  activeRunId: string | null
  hasMore: boolean
  /** 收在工具栏浮窗里（窄，且纵向空间紧张）——去掉触发方式列、收紧左侧 */
  compact?: boolean
}>()
defineEmits<{ (e: 'open', runId: string): void; (e: 'load-more'): void }>()

/** 时间轴节点：成功实心绿 / 失败实心红 / 其余空心灰 */
function nodeTone(status: string): string {
  if (status === 'done') return 'ok'
  if (status === 'error' || status === 'timeout') return 'bad'
  return ''
}

function absText(r: RunDto): string {
  const d = new Date(r.startedAt ?? r.queuedAt)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function metaText(r: RunDto): string {
  if (r.status === 'queued' || r.status === 'running') return '—'
  const bits: string[] = []
  if (r.numTurns != null) bits.push(`${r.numTurns} 轮`)
  if (r.durationMs != null) bits.push(formatDuration(r.durationMs))
  if (r.totalCostUsd != null) bits.push(`$${r.totalCostUsd.toFixed(3)}`)
  return bits.join(' · ') || '—'
}
</script>

<style scoped>
.tl { position: relative; padding: 8px 18px 8px 44px; }
.tl.compact { padding: 6px 8px 6px 34px; }
.tl.compact::before { left: 18px; }
.tl.compact .tlrow { gap: 8px; padding: 7px 9px; }
.tl.compact .tlrow .node { left: -19px; }
.tl.compact .tlrow .when { width: 84px; }
.tl.compact .tlrow .mt { font-size: 11px; }
/* 连接线只画在首尾节点之间，两端各留 22px，不顶到容器边 */
.tl::before {
  content: '';
  position: absolute;
  left: 26px;
  top: 22px;
  bottom: 22px;
  width: 1px;
  background: var(--border-strong);
}
.tlrow {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--fs-caption);
}
.tlrow:hover { background: var(--bg-hover); }
.tlrow.sel { background: var(--bg-selected); }
.tlrow .node {
  position: absolute;
  left: -24px;
  top: 50%;
  margin-top: -6px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--bg-primary);
  border: 2px solid var(--text-tertiary);
}
.tlrow .node.ok {
  border-color: var(--status-success);
  background: var(--status-success);
  box-shadow: 0 0 0 3px var(--status-success-soft);
}
.tlrow .node.bad {
  border-color: var(--status-error);
  background: var(--status-error);
  box-shadow: 0 0 0 3px var(--status-error-soft);
}
.tlrow .when { width: 96px; flex: none; color: var(--text-primary); font-weight: 500; }
.tlrow .tg { width: 34px; flex: none; color: var(--text-tertiary); }
.tlrow .ms {
  flex: 1;
  min-width: 0;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tlrow .mt {
  flex: none;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.tlrow .ar { color: var(--text-tertiary); flex: none; }
.more { padding: 10px 18px 18px; text-align: center; }
</style>
