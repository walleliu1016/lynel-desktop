<script setup lang="ts">
import Icon from './Icon.vue'

defineProps<{ collapsed: boolean }>()
defineEmits<{ (e: 'toggle-collapse'): void }>()
</script>

<template>
  <aside class="workspace-panel" :class="{ collapsed }">
    <div class="ws-head">
      <span class="ws-title">Workspace</span>
      <button class="collapse-btn" aria-label="收起 Workspace" title="收起 Workspace" @click="$emit('toggle-collapse')">
        <Icon name="panel-right-close" :size="16" />
      </button>
    </div>
    <div class="ws-placeholder">
      <span>Workspace 面板待实现</span>
    </div>
  </aside>
</template>

<style scoped>
.workspace-panel {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  min-height: 0;
  overflow: hidden;
  transition: width 0.2s ease;
}
.workspace-panel.collapsed { width: 0; border-left: none; }
.ws-head {
  height: 40px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--border);
}
.ws-title { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.collapse-btn {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background: transparent; border: 1px solid var(--border); cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}
.collapse-btn:hover { background: var(--bg-input); border-color: var(--accent); color: var(--accent); }
.ws-placeholder {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--text-tertiary);
}
</style>
