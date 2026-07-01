<template>
  <div class="settings">
    <TitleBar @minimize="onMinimize" @maximize="onMaximize" @close="onClose" />
    <div class="layout">
      <nav class="sidebar">
        <button class="back" @click="goBack">← 返回</button>
        <div class="sep" />
        <button v-for="t in tabs" :key="t" class="tab"
                :class="{ active: active === t }" @click="active = t">
          <span class="tab-icon">{{ tabIcon(t) }}</span>
          <span class="tab-label">{{ tabLabel(t) }}</span>
        </button>
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
import HooksTab from '../components/settings/HooksTab.vue'
import GeneralTab from '../components/settings/GeneralTab.vue'
import CloudTab from '../components/settings/CloudTab.vue'
import ProviderTab from '../components/settings/ProviderTab.vue'
import { WindowMinimise, WindowToggleMaximise, WindowHide, GetHookServerPort } from '../composables/useWails'

const router = useRouter()
type Tab = 'general' | 'hooks' | 'cloud' | 'provider'
const tabs: Tab[] = ['general', 'hooks', 'cloud', 'provider']
const active = ref<Tab>('general')
const hookPort = ref(0)

onMounted(async () => {
  try { hookPort.value = await GetHookServerPort() } catch {}
})

function tabLabel(t: Tab) { return { hooks: 'Hooks', general: '通用', cloud: '云服务', provider: '模型供应商' }[t] }
function tabIcon(t: Tab) { return { hooks: '⚡', general: '⚙', cloud: '☁', provider: '🤖' }[t] }
function goBack() { router.push('/home') }
function onMinimize() { WindowMinimise() }
function onMaximize() { WindowToggleMaximise() }
function onClose()    { WindowHide() }
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
.tab {
  display: flex; align-items: center; gap: 10px;
  text-align: left; padding: 9px 12px; border-radius: var(--radius-md);
  color: var(--text-secondary); font-size: 13px; border: none; background: none; cursor: pointer;
}
.tab:hover { background: var(--bg-input); color: var(--text-primary); }
.tab.active { background: rgba(139,92,246,0.12); color: var(--accent-light); font-weight: 600; }
.tab-icon { font-size: 14px; width: 20px; text-align: center; flex-shrink: 0; }
.back { padding: 8px 12px; color: var(--text-secondary); font-size: 12px; text-align: left; border-radius: var(--radius-md); }
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
