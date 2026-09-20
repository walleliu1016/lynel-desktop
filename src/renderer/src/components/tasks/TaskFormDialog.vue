<!-- 占位组件：Task 16「表单与设置项」会用真正的新建/编辑弹窗整体替换本文件。
     本 task（Task 13）只搭骨架，这里仅声明 TasksPane 传进来的 props / emits，不渲染真实表单 UI。 -->
<template>
  <div class="dialog">
    <div class="box">
      <div class="hd">{{ task ? '编辑任务' : '新建任务' }}</div>
      <div class="bd">表单待实现（Task 16）</div>
      <div class="ft">
        <button class="btn" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ScheduleDto, TaskDto } from '../../types/tasks'

defineProps<{ task: TaskDto | null }>()

defineEmits<{
  (e: 'close'): void
  (e: 'submit', input: { name: string; prompt: string; schedule: ScheduleDto }): void
}>()
</script>

<style scoped>
.dialog {
  position: fixed; inset: 0; z-index: 200;
  display: flex; align-items: center; justify-content: center;
  background: var(--scrim);
}
.box {
  min-width: 300px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
}
.hd { padding: 12px 16px; font-size: var(--fs-body-sm); font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--border); }
.bd { padding: 18px 16px; font-size: var(--fs-caption); color: var(--text-tertiary); }
.ft { padding: 10px 12px; display: flex; justify-content: flex-end; border-top: 1px solid var(--border); }
.btn {
  padding: 5px 10px; border-radius: var(--radius-sm); font-size: var(--fs-caption);
  border: 1px solid var(--border); background: var(--bg-card);
  color: var(--text-secondary); cursor: pointer; font-family: inherit;
}
.btn:hover { background: var(--bg-hover); }
</style>
