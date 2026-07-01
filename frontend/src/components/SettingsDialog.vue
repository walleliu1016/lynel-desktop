<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="dialog">
      <div class="head">
        <h2>设置</h2>
        <button class="close" @click="$emit('close')">✕</button>
      </div>
      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t"
          class="tab"
          :class="{ active: active === t }"
          @click="active = t"
        >
          <span class="tab-icon">{{ tabIcon(t) }}</span>
          <span class="tab-label">{{ tabLabel(t) }}</span>
        </button>
      </div>
      <div class="content">
        <HooksTab v-if="active === 'hooks'" />
        <GeneralTab v-else-if="active === 'general'" />
        <CloudTab v-else-if="active === 'cloud'" />
        <ProviderTab v-else-if="active === 'provider'" />
      </div>
      <div v-if="hookPort" class="foot">
        <span class="port-dot" />
        Hook :{{ hookPort }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import HooksTab from './settings/HooksTab.vue'
import GeneralTab from './settings/GeneralTab.vue'
import CloudTab from './settings/CloudTab.vue'
import ProviderTab from './settings/ProviderTab.vue'
import { GetHookServerPort } from '../composables/useWails'

defineEmits<{ (e: 'close'): void }>()

type Tab = 'general' | 'hooks' | 'cloud' | 'provider'
const tabs: Tab[] = ['general', 'hooks', 'cloud', 'provider']
const active = ref<Tab>('general')
const hookPort = ref(0)

onMounted(async () => {
  try { hookPort.value = await GetHookServerPort() } catch {}
})

function tabLabel(t: Tab) { return { hooks: 'Hooks', general: '通用', cloud: '云服务', provider: '模型供应商' }[t] }
function tabIcon(t: Tab) { return { hooks: '⚡', general: '⚙', cloud: '☁', provider: '🤖' }[t] }
</script>

<style scoped>
.overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.dialog {
  width: 700px; height: 520px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
h2 { font-size: 14px; color: var(--text-primary); font-weight: 600; }
.close { color: var(--text-secondary); font-size: 14px; padding: 2px 6px; border-radius: var(--radius-sm); }
.close:hover { background: var(--bg-input); color: var(--text-primary); }
.tabs {
  display: flex; gap: 4px; padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0; background: var(--bg-panel);
}
.tab {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: var(--radius-md);
  color: var(--text-secondary); font-size: 12px;
  border: none; background: none; cursor: pointer;
}
.tab:hover { background: var(--bg-input); color: var(--text-primary); }
.tab.active { background: rgba(139,92,246,0.12); color: var(--accent-light); font-weight: 600; }
.tab-icon { font-size: 13px; }
.content { flex: 1; overflow-y: auto; min-height: 0; padding: 12px 16px; }
.foot {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px; font-size: 11px; color: var(--text-tertiary);
  font-family: var(--font-mono); border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.port-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--status-success); flex-shrink: 0; }
</style>
