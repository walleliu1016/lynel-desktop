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
      <button v-if="!isActive" class="icon-btn" aria-label="设为当前" title="设为当前" @click="$emit('setActive')">
        <Icon name="check" :size="14" />
      </button>
      <button class="icon-btn" aria-label="复制" title="复制" @click="$emit('copy')">
        <Icon name="copy" :size="14" />
      </button>
      <button class="icon-btn" aria-label="编辑" title="编辑" @click="$emit('edit')">
        <Icon name="pencil" :size="14" />
      </button>
      <button class="icon-btn danger" aria-label="删除" title="删除" @click="$emit('remove')">
        <Icon name="trash" :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import AgentBadge from '../../components/AgentBadge.vue'
import Icon from '../../components/Icon.vue'
import type { Provider } from '../../types/providers'

defineProps<{
  provider: Provider
  isActive: boolean
}>()

defineEmits<{
  (e: 'edit'): void
  (e: 'copy'): void
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
  transition: border-color .15s ease, box-shadow .15s ease;
}
.provider-card:hover { border-color: var(--accent-soft-border); }
.provider-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.card-head { display: flex; align-items: center; gap: 8px; }
.name { flex: 1; font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.current-badge { font-size: 10px; padding: 2px 6px; border-radius: var(--radius-sm); background: var(--accent); color: var(--text-inverse); font-weight: 600; }
.url { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.model { font-size: 11px; color: var(--text-secondary); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-actions {
  display: flex; align-items: center; gap: 6px; margin-top: 4px;
  opacity: 0; transform: translateY(3px);
  transition: opacity .15s ease, transform .15s ease;
}
.provider-card:hover .card-actions,
.provider-card:focus-within .card-actions {
  opacity: 1; transform: translateY(0);
}
.card-actions button {
  height: 28px; border-radius: var(--radius-md); font-size: 12px;
  border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); cursor: pointer;
}
.icon-btn { width: 28px; display: flex; align-items: center; justify-content: center; color: var(--text-primary); }
.icon-btn:hover { border-color: var(--accent); color: var(--accent-deep); }
.icon-btn.danger:hover { color: var(--status-error); border-color: var(--status-error); }
</style>
