<!-- 定时任务面板：左任务列表（可拖宽） + 右详情。
     布局与 GitPanel 同构：左栏固定像素宽（200–480px，存 localStorage），右栏自适应剩余宽度。 -->
<template>
  <div class="tasks-pane">
    <TaskList
      :tasks="store.tasks"
      :active-id="store.activeTaskId"
      :width="listWidth"
      @select="store.select"
      @toggle="store.setEnabled"
      @create="openForm(null)"
      @start-resize="startResize"
    />
    <TaskDetailPane
      v-if="store.activeTask"
      :task="store.activeTask"
      :runs="store.runs"
      :has-more="store.runsHasMore"
      :active-run="store.activeRun"
      @edit="openForm(store.activeTask)"
      @remove="onRemove"
      @run-now="store.runNow"
      @load-more="store.loadRuns(true)"
      @open-run="store.openRun"
      @cancel="store.cancel"
      @close-run="store.closeRun"
    />
    <div v-else class="empty-detail">左侧选择一个任务，或新建一个</div>

    <TaskFormDialog
      v-if="formOpen"
      :task="formTask"
      @close="formOpen = false"
      @submit="onSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
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
const formTask = ref<TaskDto | null>(null)

let offPush: (() => void) | null = null

onMounted(() => {
  void store.load()
  offPush = store.bindPush()
})
onBeforeUnmount(() => offPush?.())

function openForm(task: TaskDto | null) {
  formTask.value = task
  formOpen.value = true
}

async function onSubmit(input: { name: string; prompt: string; schedule: ScheduleDto }) {
  await store.saveTask(input, formTask.value?.id)
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
  flex: 1; min-width: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-caption); color: var(--text-tertiary);
  background: var(--bg-primary);
}
</style>
