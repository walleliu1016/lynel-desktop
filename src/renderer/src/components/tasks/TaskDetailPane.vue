<!-- 任务详情右栏：头部操作 + 键值块 + 运行历史（倒序分页），运行历史下方挂当前 run 的流水。
     不显示工作目录 / 项目（设计 D10：所有任务共用一个固定工作目录，该概念在 UI 里不存在）。 -->
<template>
  <div class="detail">
    <div class="dhd">
      <h3>{{ task.name }}</h3>
      <button class="btn primary" @click="$emit('run-now', task.id)">
        <Icon name="play" :size="14" />立即执行
      </button>
      <button class="btn ghost" title="编辑" @click="$emit('edit', task)">
        <Icon name="pencil" :size="14" />
      </button>
      <button class="btn ghost" title="删除" @click="$emit('remove', task.id)">
        <Icon name="trash" :size="14" />
      </button>
    </div>

    <div class="dbody">
      <dl class="kv">
        <dt>调度</dt>
        <dd>{{ task.schedule }} <span class="chip mono">{{ rawExpr }}</span></dd>
        <dt>状态</dt>
        <dd>
          <span class="sd" :class="task.enabled ? 'on' : 'off'" />
          {{ task.enabled ? '已启用' : '已停用' }}
        </dd>
        <dt>下次运行</dt>
        <dd>
          <template v-if="task.enabled && task.nextRunAt">
            {{ formatAbs(task.nextRunAt) }}
            <span class="dim">（{{ formatNextRun(task.nextRunAt) }}）</span>
          </template>
          <span v-else class="dim">—</span>
        </dd>
        <dt>上次运行</dt>
        <dd>
          <template v-if="task.lastRunAt">
            {{ formatAbs(task.lastRunAt) }}
            <span :class="lastStatusClass(task)">{{ statusLabel(task.lastStatus) }}</span>
          </template>
          <span v-else class="dim">还没跑过</span>
        </dd>
        <dt>Prompt</dt>
        <dd class="prompt mono">{{ task.prompt }}</dd>
      </dl>

      <div class="sep" />
      <div class="subhd">运行历史</div>

      <div class="runs">
        <div
          v-for="r in runs"
          :key="r.id"
          class="run"
          :class="{ sel: r.id === activeRun?.id }"
          @click="$emit('open-run', r.id)"
        >
          <span class="st" :class="'st-' + r.status">
            <Icon :name="statusIcon(r.status)" :size="12" />{{ statusLabel(r.status) }}
          </span>
          <span class="tg">{{ r.trigger === 'manual' ? '手动' : '自动' }}</span>
          <span class="wh">{{ formatAbs(r.startedAt ?? r.queuedAt) }}</span>
          <span class="ms">{{ runSummaryText(r.resultText, r.error, r.status) }}</span>
          <span class="rt">{{ metaText(r) }}</span>
          <Icon name="chevron-right" :size="12" class="arrow" />
        </div>
        <div v-if="runs.length === 0" class="empty">还没跑过</div>
      </div>
      <div v-if="hasMore" class="more">
        <button class="btn ghost" @click="$emit('load-more')">加载更早的运行记录</button>
      </div>

      <RunStreamView
        v-if="activeRun"
        :run="activeRun"
        :events="events"
        :task-label="task.name"
        @cancel="$emit('cancel', activeRun.id)"
        @close="$emit('close-run')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../Icon.vue'
import RunStreamView from './RunStreamView.vue'
import { formatDuration, formatNextRun, runSummaryText } from '../../utils/tasks'
import type { EventEnvelope, RunDto, TaskDto } from '../../types/tasks'

const props = defineProps<{
  task: TaskDto
  runs: RunDto[]
  hasMore: boolean
  activeRun: RunDto | null
  events: EventEnvelope[]
}>()
defineEmits<{
  (e: 'edit', task: TaskDto): void
  (e: 'remove', id: string): void
  (e: 'run-now', id: string): void
  (e: 'load-more'): void
  (e: 'open-run', runId: string): void
  (e: 'cancel', runId: string): void
  /** 运行流水返回按钮：收起流水、回到运行历史 */
  (e: 'close-run'): void
}>()

const LABELS: Record<string, string> = {
  queued: '排队中', running: '运行中', done: '成功', error: '失败',
  timeout: '超时', skipped: '已跳过', interrupted: '已中断',
  // 单次任务的档期过了补救窗口：scheduler 写 lastStatus='missed' 但不更新 lastRunAt，
  // 该状态会真的出现在「上次运行」行上。文案与 TaskList 的列表第二行保持一致。
  missed: '已过期',
}
const ICONS: Record<string, string> = {
  queued: 'clock', running: 'loader', done: 'check', error: 'warning',
  timeout: 'clock', skipped: 'slash', interrupted: 'slash',
}

/** 原始表达式：cron 取表达式原文，单次任务取格式化后的触发时间 */
const rawExpr = computed(() =>
  props.task.scheduleRaw.type === 'cron'
    ? props.task.scheduleRaw.expression
    : formatAbs(props.task.scheduleRaw.runAt),
)

const statusLabel = (s: string | null) => (s ? LABELS[s] ?? s : '—')
const statusIcon = (s: string) => ICONS[s] ?? 'clock'

function lastStatusClass(t: TaskDto): string {
  if (t.lastStatus === 'done') return 'st-done'
  if (t.lastStatus && ['error', 'timeout', 'interrupted'].includes(t.lastStatus)) return 'st-error'
  return 'dim'
}

function formatAbs(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function metaText(r: RunDto): string {
  if (r.status === 'queued' || r.status === 'running') return '—'
  const bits: string[] = []
  if (r.durationMs != null) bits.push(formatDuration(r.durationMs))
  if (r.numTurns != null) bits.push(`${r.numTurns} 轮`)
  if (r.totalCostUsd != null) bits.push(`$${r.totalCostUsd.toFixed(3)}`)
  return bits.join(' · ') || '—'
}
</script>

<style scoped>
.detail { flex: 1; min-width: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--bg-primary); }
.dhd {
  padding: 12px 16px; display: flex; align-items: center; gap: 8px;
  border-bottom: 1px solid var(--border); background: var(--bg-panel);
}
.dhd h3 {
  font-size: var(--fs-body); font-weight: 600; margin: 0; flex: 1;
  color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 运行历史可能很长（Prompt 也可能多行），详情区要能滚 */
.dbody { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; }

.kv { display: grid; grid-template-columns: 76px 1fr; gap: 7px 12px; margin: 0; }
.kv dt { color: var(--text-tertiary); font-size: var(--fs-caption); }
.kv dd {
  margin: 0; font-size: var(--fs-body-sm); color: var(--text-primary);
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
/* Prompt 是长文本，不参与上面那条 flex 单行布局 */
.kv dd.prompt { display: block; white-space: pre-wrap; word-break: break-word; color: var(--text-secondary); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dim { color: var(--text-tertiary); }
.chip {
  font-size: 10px; padding: 2px 7px; border-radius: var(--radius-pill);
  background: var(--bg-hover); color: var(--text-secondary);
}
.sep { height: 1px; background: var(--border); margin: 14px 0 12px; }
.subhd {
  font-size: 10px; letter-spacing: .6px; color: var(--text-tertiary);
  text-transform: uppercase; margin-bottom: 8px;
}

.sd { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.sd.on { background: var(--status-success); }
.sd.off { background: var(--text-tertiary); opacity: .45; }

.runs { border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; background: var(--bg-card); }
.run {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  font-size: var(--fs-caption); cursor: pointer;
  border-bottom: 1px solid var(--border);
}
.run:last-child { border-bottom: none; }
.run:hover { background: var(--bg-hover); }
.run.sel { background: var(--bg-selected); }
.run .st { display: inline-flex; align-items: center; gap: 5px; width: 74px; flex: none; }
.run .tg { width: 34px; flex: none; color: var(--text-tertiary); }
.run .wh { width: 116px; flex: none; color: var(--text-secondary); }
.run .ms {
  flex: 1; min-width: 0; color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.run .rt { flex: none; display: flex; gap: 10px; color: var(--text-secondary); }
.run .arrow { color: var(--text-tertiary); flex: none; }
.st-done { color: var(--status-success); }
.st-error, .st-timeout { color: var(--status-error); }
.st-running { color: var(--accent); }
.st-queued, .st-skipped, .st-interrupted { color: var(--text-tertiary); }
.more { padding: 10px; text-align: center; }
.empty { padding: 18px 12px; text-align: center; color: var(--text-tertiary); }

/* 与 TaskList 同款的按钮（.btn 不是全局类） */
.btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px;
  border-radius: var(--radius-sm); font-size: var(--fs-caption);
  border: 1px solid var(--border); background: var(--bg-card);
  color: var(--text-secondary); cursor: pointer; font-family: inherit;
}
.btn:hover { background: var(--bg-hover); }
.btn.primary { background: var(--accent); color: var(--text-inverse); border-color: transparent; }
.btn.primary:hover { background: var(--accent-deep); }
.btn.ghost { border-color: transparent; background: transparent; padding: 5px 7px; }
.btn.ghost:hover { background: var(--bg-hover); color: var(--text-primary); }
</style>
