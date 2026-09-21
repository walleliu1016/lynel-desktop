<!-- 定时任务面板：左任务列表（可拖宽） + 右详情。
     布局与 GitPanel 同构：左栏固定像素宽（200–480px，存 localStorage），右栏自适应剩余宽度。
     运行历史收在工具栏的「历史」按钮里（点击弹浮窗），不占正文位置。 -->
<template>
  <div class="tasks-pane">
    <TaskList
      :tasks="store.tasks"
      :active-id="store.activeTaskId"
      :width="listWidth"
      @select="store.select"
      @toggle="store.setEnabled"
      @create="openForm('create', null)"
      @start-resize="startResize"
    />
    <TaskDetailPane
      v-if="store.activeTask"
      :task="store.activeTask"
      :runs="store.runs"
      :has-more="store.runsHasMore"
      :active-run="store.activeRun"
      :active-run-id="store.activeRunId"
      :events="store.events"
      :is-latest="isLatest"
      :run-badge="runBadge"
      @edit="openForm('edit', $event)"
      @copy="openForm('copy', $event)"
      @remove="onRemove"
      @run-now="store.runNow"
      @load-more="store.loadRuns(true)"
      @open-run="store.openRun"
      @view-latest="viewLatest"
      @cancel="store.cancel"
    />
    <div v-else class="empty-detail">
      <div class="blank">
        <div class="ic"><Icon name="plus" :size="20" /></div>
        <h4>还没有任务</h4>
        <p>新建一个定时任务，或用「复制为新任务」把已有的改一份。</p>
        <button class="btn primary tall" @click="openForm('create', null)">
          <Icon name="plus" :size="13" />新建任务
        </button>
      </div>
    </div>

    <TaskFormDialog
      v-if="formOpen"
      :mode="formMode"
      :task="formTask"
      @close="formOpen = false"
      @submit="onSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '../Icon.vue'
import TaskList from './TaskList.vue'
import TaskDetailPane from './TaskDetailPane.vue'
import TaskFormDialog from './TaskFormDialog.vue'
import { useTasksStore } from '../../stores/tasks'
import type { ScheduleDto, TaskDto } from '../../types/tasks'

const WIDTH_KEY = 'lynel:tasks-list-width'
const MIN_WIDTH = 200
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 268

/** 宽度守恒：localStorage 里的脏值（NaN / 越界）一律回落到默认值，避免左栏撑爆或塌缩 */
function loadListWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH) return v
  } catch {}
  return DEFAULT_WIDTH
}

const store = useTasksStore()
const listWidth = ref(loadListWidth())
const formOpen = ref(false)
const formMode = ref<'create' | 'edit' | 'copy'>('create')
const formTask = ref<TaskDto | null>(null)

let offPush: (() => void) | null = null

onMounted(() => {
  void store.load()
  void store.loadTemplates()
  offPush = store.bindPush()
})
onBeforeUnmount(() => offPush?.())

/** 展示的是不是最近那一次运行 —— 决定流水头部显不显示「回到最新」 */
const isLatest = computed(
  () => store.activeRunId != null && store.activeRunId === store.runs[0]?.id,
)

/** 历史按钮上的徽标：只统计已加载的条数，还有更早的分页时带 + 后缀，不谎报总数 */
const runBadge = computed(() =>
  store.runsHasMore ? `${store.runs.length}+` : String(store.runs.length),
)

function openForm(mode: 'create' | 'edit' | 'copy', task: TaskDto | null) {
  formMode.value = mode
  formTask.value = task
  formOpen.value = true
}

function viewLatest() {
  const latest = store.runs[0]
  if (latest) void store.openRun(latest.id)
}

async function onSubmit(input: { name: string; prompt: string; schedule: ScheduleDto }) {
  await store.saveTask(input, formMode.value === 'edit' ? formTask.value?.id : undefined)
  formOpen.value = false
}

async function onRemove(id: string) {
  if (!confirm('删除任务会同时删除它的运行历史，确定吗？')) return
  await store.remove(id)
}

// ---- 左栏拖宽（与 GitPanel 同构） ----
let startX = 0
let startW = 0
function onMove(e: MouseEvent) {
  const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (e.clientX - startX)))
  listWidth.value = next
}
function onUp() {
  try {
    localStorage.setItem(WIDTH_KEY, String(listWidth.value))
  } catch {}
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
}
function startResize(e: MouseEvent) {
  startX = e.clientX
  startW = listWidth.value
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
</script>

<style scoped>
.tasks-pane { flex: 1; min-height: 0; display: flex; height: 100%; }
.empty-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  background: var(--bg-primary);
}
</style>
