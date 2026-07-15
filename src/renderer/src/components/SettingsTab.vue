<template>
  <div class="settings-tab">
    <nav class="sidebar">
      <SettingsTabs v-model="active" layout="vertical" />
      <div class="sidebar-footer">
        <div class="hook-port" v-if="hookPort">
          <span class="port-dot" />
          Hook :{{ hookPort }}
        </div>
      </div>
    </nav>
    <main class="content">
      <GeneralTab v-if="active === 'general'" />
      <CloudTab v-else-if="active === 'cloud'" />
      <ProviderTab v-else-if="active === 'provider'" />
      <ChannelTab v-else-if="active === 'channel'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import SettingsTabs, { type Tab } from './SettingsTabs.vue'
import GeneralTab from './settings/GeneralTab.vue'
import CloudTab from './settings/CloudTab.vue'
import ProviderTab from './settings/ProviderTab.vue'
import ChannelTab from './settings/ChannelTab.vue'
import { GetHookServerPort } from '../composables/useElectron'

const active = ref<Tab>('general')
const hookPort = ref(0)

onMounted(async () => {
  try { hookPort.value = await GetHookServerPort() } catch {}
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
.sidebar-footer {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.hook-port {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}
.port-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--status-success);
  flex-shrink: 0;
}
.content {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}
</style>
