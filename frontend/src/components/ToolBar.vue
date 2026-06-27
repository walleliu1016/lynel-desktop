<template>
  <div class="toolbar">
    <div class="info">
      <span class="status" :class="state"></span>
      <span class="title">{{ title }}</span>
      <span class="path mono">{{ path }}</span>
    </div>
    <button class="open-term" @click="$emit('open-terminal')">›_ 打开终端</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; path: string; state: 'idle' | 'running' | 'awaiting_permission' }>()
defineEmits<{ (e: 'open-terminal'): void }>()
</script>

<style scoped>
.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.info { display: flex; align-items: center; gap: 8px; min-width: 0; }
.status { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
.status.running { background: var(--status-success); }
.status.awaiting_permission { background: var(--status-warn); }
.title { font-size: 12px; color: var(--text-primary); font-weight: 500; }
.path { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 360px; }
.open-term {
  font-size: 11px; padding: 4px 10px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); color: var(--text-primary);
  font-family: var(--font-mono);
}
.open-term:hover { background: var(--border); }
.mono { font-family: var(--font-mono); }
</style>
