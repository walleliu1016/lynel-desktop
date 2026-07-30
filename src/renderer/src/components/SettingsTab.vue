<template>
  <div class="settings-tab">
    <nav class="sidebar">
      <SettingsTabs v-model="active" layout="vertical" />
    </nav>
    <main class="content">
      <GeneralTab v-if="active === 'general'" />
      <AppearanceTab v-else-if="active === 'appearance'" />
      <CloudTab v-else-if="active === 'cloud'" />
      <ProviderTab v-else-if="active === 'provider'" />
      <BotManagement v-else-if="active === 'bot'" />
      <UpdaterTab v-else-if="active === 'updater'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import SettingsTabs, { type Tab } from './SettingsTabs.vue'
import GeneralTab from './settings/GeneralTab.vue'
import AppearanceTab from './settings/AppearanceTab.vue'
import CloudTab from './settings/CloudTab.vue'
import ProviderTab from './settings/ProviderTab.vue'
import BotManagement from './settings/BotManagement.vue'
import UpdaterTab from './settings/UpdaterTab.vue'

const active = ref<Tab>('general')
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
