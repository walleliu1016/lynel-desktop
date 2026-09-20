<!-- 占位组件：Task 15「运行流水渲染」会用真实实现整体替换本文件。
     本 task（Task 14）只声明 TaskDetailPane 传进来的 props / emits，不渲染真实流水 UI。
     流水需要的事件已由 TaskDetailPane 从 store 透传（:run / :events / :task-label）。 -->
<template>
  <div class="stream">
    <div class="shd">
      <span class="ttl">{{ taskLabel ?? '运行流水' }}</span>
      <span class="hint">运行流水待实现（Task 15）· {{ events.length }} 条事件</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { EventEnvelope, RunDto } from '../../types/tasks'

defineProps<{
  run: RunDto
  events: EventEnvelope[]
  taskLabel?: string
}>()

defineEmits<{
  (e: 'cancel'): void
  (e: 'close'): void
}>()
</script>

<style scoped>
.stream {
  margin-top: 14px; padding-top: 10px;
  border-top: 1px solid var(--border);
}
.shd { display: flex; align-items: center; gap: 10px; font-size: var(--fs-caption); }
.ttl { font-weight: 600; color: var(--text-primary); }
.hint { color: var(--text-tertiary); }
</style>
