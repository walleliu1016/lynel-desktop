<!-- 任务详情：工具栏（名称 + 运行/历史切换 + 立即执行 + 溢出菜单）
     → 摘要 chips → 主体（默认渲染最近一次运行的完整流水，不再是空白）。
     运行历史不再平铺在下面，收进工具栏的分段，点历史行切回那一次运行。 -->
<template>
  <div class="detail">
    <div class="tbar">
      <span class="sd" :class="task.lastStatus === 'error' ? 'err' : task.enabled ? 'on' : 'off'" />
      <h3 :title="task.name">{{ task.name }}</h3>

      <!-- 历史收进一个按钮 + 浮窗：不占正文的位置，也不覆盖当前这次运行的流水 -->
      <div class="histwrap">
        <button class="btn" :class="{ on: histOpen }" @click.stop="histOpen = !histOpen">
          <Icon name="history" :size="13" />历史<span class="badge">{{ runBadge }}</span>
        </button>
        <div v-if="histOpen" class="histpop" @click.stop>
          <div class="histpop-hd">运行历史</div>
          <RunHistoryList
            :runs="runs"
            :active-run-id="activeRunId"
            :has-more="hasMore"
            :compact="true"
            @open="$emit('open-run', $event)"
            @load-more="$emit('load-more')"
          />
        </div>
      </div>

      <button class="btn primary tall" @click="$emit('run-now', task.id)">
        <Icon name="play" :size="14" />立即执行
      </button>
      <div class="morewrap">
        <button class="btn ghost icon" title="更多" @click.stop="menuOpen = !menuOpen">
          <Icon name="more" :size="16" />
        </button>
        <div v-if="menuOpen" class="menu">
          <button @click="pick('edit')"><Icon name="pencil" :size="13" />编辑任务</button>
          <button @click="pick('copy')"><Icon name="copy" :size="13" />复制为新任务</button>
          <div class="sep" />
          <button class="danger" @click="pick('remove')"><Icon name="trash" :size="13" />删除任务</button>
        </div>
      </div>
    </div>

    <div class="sumbar">
      <span class="chip"><Icon name="history" :size="11" />{{ task.schedule }}</span>
      <span class="chip">
        <Icon name="clock" :size="11" />
        {{ task.enabled ? nextText : '已停用' }}
      </span>
      <span class="chip">
        上次 {{ task.lastRunAt ? statusLabel(task.lastStatus) : '还没跑过' }}
        <template v-if="task.lastRunAt"> · {{ formatRelTime(new Date(task.lastRunAt).toISOString()) }}</template>
      </span>
      <span v-if="lastCost" class="chip">均价 <b>${{ lastCost }}</b></span>
    </div>

    <!-- 主体：当前这一次运行的完整流水 -->
    <div class="dbody">
      <RunStreamView
        v-if="activeRun"
        :run="activeRun"
        :events="events"
        :is-latest="isLatest"
        @cancel="$emit('cancel', activeRun.id)"
        @latest="$emit('view-latest')"
      />
      <div v-else class="blank">
        <div class="ic"><Icon name="play" :size="20" /></div>
        <h4>这个任务还没运行过</h4>
        <p>点「立即执行」跑一次，结果会显示在这里。之后每次运行也会自动出现，不需要手动打开历史。</p>
        <button class="btn primary tall" @click="$emit('run-now', task.id)">
          <Icon name="play" :size="13" />立即执行
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import RunStreamView from './RunStreamView.vue'
import RunHistoryList from './RunHistoryList.vue'
import { formatNextRun, taskCostHint } from '../../utils/tasks'
import { formatRelTime } from '../../utils/time'
import { statusLabel } from '../../utils/taskStatus'
import type { EventEnvelope, RunDto, TaskDto } from '../../types/tasks'

const props = defineProps<{
  task: TaskDto
  runs: RunDto[]
  hasMore: boolean
  activeRun: RunDto | null
  activeRunId: string | null
  events: EventEnvelope[]
  isLatest: boolean
  /** 已加载的运行条数；还有更早的分页时带一个 + 后缀，避免谎报总数 */
  runBadge: string
}>()
const emit = defineEmits<{
  (e: 'edit', task: TaskDto): void
  (e: 'copy', task: TaskDto): void
  (e: 'remove', id: string): void
  (e: 'run-now', id: string): void
  (e: 'load-more'): void
  (e: 'open-run', runId: string): void
  (e: 'view-latest'): void
  (e: 'cancel', runId: string): void
}>()

const menuOpen = ref(false)
const histOpen = ref(false)

/** 点浮窗外面 / 按 Esc 关掉 —— 浮窗盖在流水上，不给关的话没法看被压住的那段 */
function onDocClick() {
  histOpen.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') histOpen.value = false
}
watch(histOpen, (open) => {
  if (open) {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
  } else {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onKey)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

/** 选中某一次运行后浮窗自动收起（选择本身就是「切换当前展示」） */
watch(
  () => props.activeRunId,
  () => {
    histOpen.value = false
  },
)

function pick(action: 'edit' | 'copy' | 'remove') {
  menuOpen.value = false
  if (action === 'edit') emit('edit', props.task)
  else if (action === 'copy') emit('copy', props.task)
  else emit('remove', props.task.id)
}

const nextText = computed(() =>
  props.task.nextRunAt == null ? '无下次运行' : `下次 ${formatNextRun(props.task.nextRunAt)}`)

const lastCost = computed(() => taskCostHint(props.runs[0]))
</script>

<style scoped>
.detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

/* 工具栏：52px，标题 18px —— 把层级从「一行键值对」拉开 */
.tbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 11px;
  height: 52px;
  padding: 0 18px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.tbar h3 {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: var(--fs-title);
  font-weight: 600;
  letter-spacing: -.2px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sd { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sd.on { background: var(--status-success); }
.sd.off { background: var(--text-tertiary); opacity: .45; }
.sd.err { background: var(--status-error); }

/* 历史按钮 + 浮窗：浮窗绝对定位在按钮下方，压住一小块流水而不是整页 */
.histwrap { position: relative; flex: none; }
.histwrap .btn.on { border-color: var(--accent); color: var(--accent); }
.histwrap .badge {
  font-size: 10px;
  padding: 0 5px;
  min-width: 16px;
  text-align: center;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  color: var(--text-tertiary);
}
.histwrap .btn.on .badge { background: var(--accent-soft-bg); color: var(--accent); }
.histpop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  width: 470px;
  max-width: 70vw;
  max-height: 62vh;
  overflow-y: auto;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-window);
  padding-bottom: 6px;
}
.histpop-hd {
  position: sticky;
  top: 0;
  padding: 9px 14px 7px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  font-size: 10px;
  letter-spacing: .7px;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--text-tertiary);
}

.morewrap { position: relative; flex: none; }
.menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 172px;
  padding: 5px;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-panel);
}
.menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}
.menu button:hover { background: var(--bg-hover); color: var(--text-primary); }
.menu button.danger:hover { background: var(--status-error-soft); color: var(--status-error); }
.menu .sep { height: 1px; background: var(--border); margin: 5px 3px; }

.sumbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 18px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

/* 主体自身滚动：外层不滚，工具栏与摘要条才不会被滚走 */
.dbody { flex: 1; min-height: 0; overflow-y: auto; }
.stream { padding: 16px 20px 26px; }
</style>
