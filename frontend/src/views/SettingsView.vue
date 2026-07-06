<template>
  <div class="settings">
    <TitleBar />
    <div class="layout">
      <nav class="sidebar">
        <button class="back" @click="goBack">
          <Icon name="back" :size="14" />
          返回
        </button>
        <div class="sep" />
        <SettingsTabs v-model="active" layout="vertical" />
        <div class="sidebar-footer">
          <div class="hook-port" v-if="hookPort">
            <span class="port-dot" />
            Hook :{{ hookPort }}
          </div>
        </div>
      </nav>
      <main class="content">
        <HooksTab v-if="active === 'hooks'" />
        <GeneralTab v-else-if="active === 'general'" />
        <CloudTab v-else-if="active === 'cloud'" />
        <ProviderTab v-else-if="active === 'provider'" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import Icon from '../components/Icon.vue'
import SettingsTabs, { type Tab } from '../components/SettingsTabs.vue'
import HooksTab from '../components/settings/HooksTab.vue'
import GeneralTab from '../components/settings/GeneralTab.vue'
import CloudTab from '../components/settings/CloudTab.vue'
import ProviderTab from '../components/settings/ProviderTab.vue'
import { GetHookServerPort } from '../composables/useElectron'

const router = useRouter()
const active = ref<Tab>('general')
const hookPort = ref(0)

onMounted(async () => {
  try { hookPort.value = await GetHookServerPort() } catch {}
})

function goBack() { router.push('/home') }
</script>

<style scoped>
.settings { display: flex; flex-direction: column; height: 100vh; background: var(--bg-primary); }
.layout { flex: 1; display: flex; min-height: 0; }
.sidebar {
  width: 200px; background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 12px 8px; gap: 2px;
  flex-shrink: 0;
}
.back {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; color: var(--text-secondary); font-size: 12px;
  text-align: left; border-radius: var(--radius-md);
}
.back:hover { color: var(--text-primary); background: var(--bg-input); }
.sep { border-top: 1px solid var(--border); margin: 6px 10px; }
.sidebar-footer { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border); }
.hook-port {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; font-size: 11px; color: var(--text-tertiary);
  font-family: var(--font-mono);
}
.port-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--status-success); flex-shrink: 0; }
.content { flex: 1; overflow-y: auto; min-width: 0; }
</style>
