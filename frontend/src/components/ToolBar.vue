<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <span class="title">{{ title }}</span>
      <span v-if="aiTitle" class="ai-title">{{ aiTitle }}</span>
    </div>
    <div class="toolbar-right">
      <span v-if="project" class="project">{{ project }}</span>
      <span class="msg-count">{{ msgCount }} 条消息</span>
      <span class="state" :class="state">{{ stateLabel }}</span>
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
    case 'waiting': return '等待中…'
    case 'thinking': return '思考中…'
    case 'streaming': return '生成中…'
    case 'running_tool': return '执行工具中…'
    case 'awaiting_permission': return '等待授权'
    default: return ''
  }
})
</script>

<style scoped>
.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 12px; border-bottom: 1px solid var(--border);
  background: var(--bg-panel); flex-shrink: 0; gap: 12px; height: 40px;
}
.toolbar-left { display: flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden; }
.toolbar-right { display: flex; align-items: center; gap: 7px; }
.title {
  font-size: 13px; color: var(--text-primary); font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ai-title {
  font-size: 12px; color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.project { font-size: 12px; color: var(--text-tertiary); font-family: var(--font-mono); }
.msg-count { font-size: 12px; color: var(--text-tertiary); }
.state {
  font-size: 11px; color: var(--text-secondary); white-space: nowrap;
  padding: 2px 7px; border-radius: 999px;
}
.state.waiting { color: var(--accent-light); background: var(--accent-soft-bg); }
.state.thinking { color: var(--accent); background: var(--accent-soft-bg); }
.state.streaming { color: var(--status-success); background: rgba(52, 211, 153, 0.12); }
.state.running_tool { color: var(--status-warn); background: var(--status-warn-bg); }
.state.awaiting_permission { color: var(--status-warn); background: var(--status-warn-bg); }
</style>
