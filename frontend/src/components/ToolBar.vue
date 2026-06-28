<template>
  <div class="toolbar">
    <div class="left">
      <span class="status" :class="state"></span>
      <span class="title">{{ displayTitle }}</span>
      <span class="sep">·</span>
      <span class="meta mono">{{ projectName }}</span>
      <span class="sep">·</span>
      <span class="meta">{{ msgCount }} 条消息</span>
      <span class="sep">·</span>
      <span class="owner-badge" :class="owner">
        <span class="dot" />
        {{ owner === 'terminal' ? '外部终端中' : 'App 控制' }}
      </span>
    </div>
    <button
      v-if="owner === 'terminal'"
      class="term-btn takeback"
      @click="$emit('takeback')"
      title="结束外部终端进程，切回 App 控制"
    >
      切回 App 控制
    </button>
    <button
      v-else
      class="term-btn"
      @click="$emit('open-terminal')"
      title="在外部终端打开会话（App 只读 jsonl）"
    >
      在终端中打开
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  aiTitle?: string
  path: string
  sessionId: string
  msgCount: number
  state: 'idle' | 'running' | 'awaiting_permission' | 'done'
  // 'app' = Ease UI 持 stdin，可写；'terminal' = 外部 claude -r 持 stdin，App 只读
  owner: 'app' | 'terminal'
}>()
defineEmits<{
  (e: 'open-terminal'): void
  (e: 'takeback'): void
}>()

const displayTitle = computed(() => (props as any).aiTitle || props.title || '新会话')
const projectName = computed(() => {
  const wd = props.path
  if (!wd || wd === '/') return wd
  return wd.split('/').filter(Boolean).pop() || wd
})
</script>

<style scoped>
.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 12px; border-bottom: 1px solid var(--border);
  background: var(--bg-panel); flex-shrink: 0; gap: 12px; height: 38px;
}
.left { display: flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden; }
.status { width: 7px; height: 7px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
.status.running { background: var(--status-success); }
.status.awaiting_permission { background: var(--status-warn); }
.status.done { background: var(--text-tertiary); }
.title {
  font-size: 12px; color: var(--text-primary); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sep { color: var(--border); flex-shrink: 0; }
.meta { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; }
.mono { font-family: var(--font-mono); }
.owner-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 7px; border-radius: 999px;
  font-size: 10px; font-weight: 500;
  white-space: nowrap; flex-shrink: 0;
}
.owner-badge .dot { width: 5px; height: 5px; border-radius: 50%; }
.owner-badge.app {
  color: var(--accent-light);
  background: rgba(139, 92, 246, 0.12);
}
.owner-badge.app .dot { background: var(--accent); }
.owner-badge.terminal {
  color: var(--status-warn);
  background: rgba(251, 191, 36, 0.12);
}
.owner-badge.terminal .dot { background: var(--status-warn); }
.term-btn {
  flex-shrink: 0;
  padding: 4px 12px;
  background: var(--accent); color: white;
  border: none; border-radius: var(--radius-md);
  font-size: 11px; font-weight: 500; cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}
.term-btn:hover { background: var(--accent-deep); }
.term-btn.takeback {
  background: var(--status-warn); color: #000;
}
.term-btn.takeback:hover { background: #F59E0B; }
</style>
