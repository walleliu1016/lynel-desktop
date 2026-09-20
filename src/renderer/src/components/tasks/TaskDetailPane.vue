<!-- 占位组件：Task 14「详情与运行历史」会用真正的详情面板整体替换本文件。
     本 task（Task 13）只搭骨架，这里仅声明 TasksPane 传进来的 props / emits，不渲染真实详情 UI。 -->
<template>
  <div class="detail">
    <div class="detail-hd">
      <span class="name">{{ task.name }}</span>
      <span class="hint">详情面板待实现（Task 14）· {{ runs.length }} 条运行记录</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RunDto, TaskDto } from '../../types/tasks'

defineProps<{
  task: TaskDto
  runs: RunDto[]
  hasMore: boolean
  activeRun: RunDto | null
}>()

defineEmits<{
  (e: 'edit'): void
  (e: 'remove', id: string): void
  (e: 'run-now', id: string): void
  (e: 'load-more'): void
  (e: 'open-run', id: string): void
  (e: 'cancel', runId: string): void
  (e: 'close-run'): void
}>()
</script>

<style scoped>
.detail { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg-primary); }
.detail-hd {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.name { font-size: var(--fs-body); font-weight: 600; color: var(--text-primary); }
.hint { font-size: var(--fs-caption); color: var(--text-tertiary); }
</style>
