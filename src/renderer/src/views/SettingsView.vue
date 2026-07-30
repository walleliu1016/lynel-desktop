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
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import Icon from '../components/Icon.vue'
import SettingsTabs, { type Tab } from '../components/SettingsTabs.vue'
import GeneralTab from '../components/settings/GeneralTab.vue'
import AppearanceTab from '../components/settings/AppearanceTab.vue'
import CloudTab from '../components/settings/CloudTab.vue'
import ProviderTab from '../components/settings/ProviderTab.vue'
import BotManagement from '../components/settings/BotManagement.vue'
import UpdaterTab from '../components/settings/UpdaterTab.vue'

const router = useRouter()
const active = ref<Tab>('general')

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
.content { flex: 1; overflow-y: auto; min-width: 0; }
</style>

