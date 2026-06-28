<template>
  <div class="settings">
    <TitleBar @minimize="onMinimize" @maximize="onMaximize" @close="onClose" />
    <div class="layout">
      <nav class="tabs">
        <button class="back" @click="goBack">← 返回主页</button>
        <div class="sep" />
        <button v-for="t in tabs" :key="t" class="tab"
                :class="{ active: active === t }" @click="active = t">
          {{ tabLabel(t) }}
        </button>
        <div class="spacer" />
      </nav>
      <main class="content">
        <HooksTab v-if="active === 'hooks'" />
        <GeneralTab v-else-if="active === 'general'" />
        <CloudTab v-else-if="active === 'cloud'" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import HooksTab from '../components/settings/HooksTab.vue'
import GeneralTab from '../components/settings/GeneralTab.vue'
import CloudTab from '../components/settings/CloudTab.vue'
import { WindowMinimise, WindowToggleMaximise, WindowQuit } from '../composables/useWails'

const router = useRouter()
type Tab = 'general' | 'hooks' | 'cloud'
const tabs: Tab[] = ['general', 'hooks', 'cloud']
const active = ref<Tab>('general')

function tabLabel(t: Tab) {
  return { hooks: 'Hook 配置', general: '通用', cloud: '云服务' }[t]
}
function goBack() { router.push('/home') }
function onMinimize() { WindowMinimise() }
function onMaximize() { WindowToggleMaximise() }
function onClose()    { WindowQuit() }
</script>

<style scoped>
.settings { display: flex; flex-direction: column; height: 100vh; }
.layout { flex: 1; display: flex; min-height: 0; }
.tabs {
  width: 180px; background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 10px 8px; gap: 4px;
}
.tab {
  text-align: left; padding: 8px 12px; border-radius: var(--radius-md);
  color: var(--text-secondary); font-size: 12px;
}
.tab:hover { background: var(--bg-input); color: var(--text-primary); }
.tab.active { background: rgba(124,58,237,0.15); color: var(--accent-light); }
.spacer { flex: 1; }
.back { padding: 8px 12px; color: var(--text-secondary); font-size: 12px; text-align: left; border-radius: var(--radius-md); }
.back:hover { color: var(--text-primary); background: var(--bg-input); }
.sep { border-top: 1px solid var(--border); margin: 4px 8px; }
.content { flex: 1; overflow-y: auto; }
</style>
