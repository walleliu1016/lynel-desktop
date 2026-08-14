<template>
  <div class="provider-card" :class="{ active: isActive }">
    <div class="card-head">
      <span class="name">{{ provider.name || '未命名供应商' }}</span>
      <AgentBadge :agent="(provider.agent || 'claude') as any" size="sm" />
      <span v-if="isActive" class="current-badge">当前</span>
    </div>
    <div class="card-body">
      <div class="url" :title="provider.base_url">{{ provider.base_url || '未设置 Base URL' }}</div>
      <div v-if="provider.default_model" class="model">{{ provider.default_model }}</div>
    </div>
    <div class="card-actions">
      <button v-if="!isActive" class="set-active" @click="$emit('setActive')">设为当前</button>
      <button class="edit" @click="$emit('edit')">编辑</button>
      <button class="remove" @click="$emit('remove')">删除</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import AgentBadge from '../../components/AgentBadge.vue'
import type { Provider } from '../../types/providers'

defineProps<{
  provider: Provider
  isActive: boolean
}>()

defineEmits<{
  (e: 'edit'): void
  (e: 'setActive'): void
  (e: 'remove'): void
}>()
</script>

<style scoped>
.provider-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.provider-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.card-head { display: flex; align-items: center; gap: 8px; }
.name { flex: 1; font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.current-badge { font-size: 10px; padding: 2px 6px; border-radius: var(--radius-sm); background: var(--accent); color: var(--text-inverse); font-weight: 600; }
.url { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.model { font-size: 11px; color: var(--text-secondary); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-actions { display: flex; gap: 6px; margin-top: 4px; }
.card-actions button {
  flex: 1; padding: 5px 0; font-size: 12px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); cursor: pointer;
}
.card-actions button.set-active { background: var(--accent); border-color: var(--accent); color: var(--text-inverse); }
.card-actions button.remove { color: var(--status-error); border-color: var(--status-error); }
</style>
