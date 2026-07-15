<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <div class="title-row">
        <span class="title" :title="title">{{ title }}</span>
        <span class="state-badge" :class="state">{{ stateLabel }}</span>
      </div>
      <div class="subtitle">
        {{ project }} · Session {{ sessionId.slice(0, 8) }} · 由终端创建
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  aiTitle?: string
  project: string
  sessionId: string
  msgCount: number
  state: 'idle' | 'waiting' | 'thinking' | 'streaming' | 'running_tool' | 'awaiting_permission' | 'done' | 'ended'
}>()

const stateLabel = computed(() => {
  switch (props.state) {
    case 'waiting': return '等待中'
    case 'thinking': return '思考中'
    case 'streaming': return '生成中'
    case 'running_tool': return '执行工具'
    case 'awaiting_permission': return '等待授权'
    case 'done': return '已完成'
    case 'ended': return '已结束'
    default: return ''
  }
})
</script>

<style scoped>
.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 18px; border-bottom: 1px solid var(--border);
  background: var(--bg-terminal-header, var(--bg-terminal)); flex-shrink: 0;
  gap: 12px; height: 48px;
}
.toolbar-left { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 3px; }
.title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.title {
  font-size: 14px; color: var(--text-primary); font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.state-badge {
  font-size: 9px; font-weight: 700; white-space: nowrap;
  padding: 3px 7px; border-radius: 6px; flex-shrink: 0;
}
.state-badge.waiting,
.state-badge.thinking,
.state-badge.streaming,
.state-badge.running_tool {
  color: var(--accent);
  background: var(--accent-soft-bg);
}
.state-badge.awaiting_permission {
  color: var(--status-error);
  background: var(--status-error-soft);
}
.state-badge.done,
.state-badge.ended {
  color: var(--status-success);
  background: var(--status-success-soft);
}
.subtitle {
  font-size: 10px; color: var(--text-tertiary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
</style>
