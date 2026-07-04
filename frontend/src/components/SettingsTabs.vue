<script setup lang="ts">
import Icon from './Icon.vue'

export type Tab = 'general' | 'hooks' | 'cloud' | 'provider'

const props = defineProps<{
  modelValue: Tab
  layout?: 'vertical' | 'horizontal'
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: Tab): void }>()

const tabs: Tab[] = ['general', 'hooks', 'cloud', 'provider']
const labels: Record<Tab, string> = {
  general: '通用',
  hooks: 'Hooks',
  cloud: '云服务',
  provider: '模型供应商',
}
const icons: Record<Tab, string> = {
  general: 'settings',
  hooks: 'zap',
  cloud: 'cloud',
  provider: 'bot',
}

function select(t: Tab) {
  emit('update:modelValue', t)
}
</script>

<template>
  <div class="settings-tabs" :class="layout ?? 'vertical'">
    <button
      v-for="t in tabs"
      :key="t"
      class="tab"
      :class="{ active: modelValue === t }"
      @click="select(t)"
    >
      <Icon :name="icons[t]" :size="14" />
      <span class="tab-label">{{ labels[t] }}</span>
    </button>
  </div>
</template>

<style scoped>
.settings-tabs {
  display: flex;
}
.settings-tabs.vertical {
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px;
}
.settings-tabs.horizontal {
  flex-direction: row;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.tab {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 13px;
  border: none;
  background: none;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.settings-tabs.horizontal .tab {
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
}
.tab:hover {
  background: var(--bg-input);
  color: var(--text-primary);
}
.tab.active {
  background: var(--accent-soft-bg);
  color: var(--accent-light);
  font-weight: 600;
}
.tab-icon {
  font-size: 14px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}
</style>
