<template>
  <div class="settings-tab">
    <nav class="sidebar">
      <SettingsTabs v-model="active" layout="vertical" />
    </nav>
    <main class="content">
      <SettingsContent :active="active" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SettingsTabs, { type Tab } from './SettingsTabs.vue'
import SettingsContent from './SettingsContent.vue'

const props = defineProps<{ active?: Tab }>()
const emit = defineEmits<{ (e: 'update:active', v: Tab): void }>()

const active = computed<Tab>({
  get: () => props.active ?? 'general',
  set: (v) => emit('update:active', v),
})
</script>

<style scoped>
.settings-tab {
  flex: 1;
  display: flex;
  min-height: 0;
  background: var(--bg-primary);
}
.sidebar {
  width: 200px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  gap: 2px;
  flex-shrink: 0;
}
.content {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}
</style>
