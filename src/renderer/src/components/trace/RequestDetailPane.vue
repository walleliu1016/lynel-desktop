<template>
  <section class="detail-pane">
    <div v-if="diffResult" class="diff-view">
      <h3>Diff: #{{ diffResult.a.seq }} vs #{{ diffResult.b.seq }}</h3>
      <p>仅展示 API 请求 body 块对比</p>
      <pre>{{ JSON.stringify(diffResult, null, 2) }}</pre>
    </div>
    <div v-else-if="!detail" class="empty">选中左侧请求查看详情</div>
    <div v-else class="tabs">
      <div class="tab-bar">
        <button v-for="t in tabs" :key="t" :class="{ on: activeTab === t }" @click="activeTab = t">
          {{ t }}
        </button>
        <span class="spacer" />
        <button v-if="activeTab === 'overview'" @click="emit('export', 'md')">↓ md</button>
        <button v-if="activeTab === 'overview'" @click="emit('export', 'json')">↓ json</button>
        <button v-if="activeTab === 'overview'" @click="emit('export', 'raw')">↓ raw</button>
        <button v-if="activeTab === 'overview'" @click="emit('export', 'har')">↓ har</button>
      </div>
      <OverviewPane v-if="activeTab === 'overview'" :detail="detail" />
      <MessagesPane v-else-if="activeTab === 'messages'" :detail="detail" />
      <ToolsPane v-else-if="activeTab === 'tools'" :detail="detail" />
      <ResponsePane v-else-if="activeTab === 'response'" :detail="detail" />
      <SystemPane v-else-if="activeTab === 'system'" :detail="detail" />
      <HeadersPane v-else-if="activeTab === 'headers'" :detail="detail" />
      <FlowPane v-else-if="activeTab === 'flow'" :detail="detail" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import OverviewPane from './detail/OverviewPane.vue'
import MessagesPane from './detail/MessagesPane.vue'
import ToolsPane from './detail/ToolsPane.vue'
import ResponsePane from './detail/ResponsePane.vue'
import SystemPane from './detail/SystemPane.vue'
import HeadersPane from './detail/HeadersPane.vue'
import FlowPane from './detail/FlowPane.vue'

defineProps<{
  detail: any
  diffResult: any
}>()

const emit = defineEmits<{
  (e: 'export', format: 'raw' | 'md' | 'json' | 'har'): void
}>()

const tabs = ['overview', 'flow', 'system', 'messages', 'tools', 'response', 'headers'] as const
const activeTab = ref<typeof tabs[number]>('overview')
</script>

<style scoped>
.detail-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.tabs { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.tab-bar { display: flex; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--border); }
.tab-bar button { background: transparent; border: 1px solid transparent; padding: 4px 12px; cursor: pointer; border-radius: 3px; font-size: 12px; }
.tab-bar button.on { background: var(--bg-active, rgba(0,120,255,0.1)); border-color: var(--border); }
.tab-bar .spacer { flex: 1; }
.diff-view { padding: 20px; overflow: auto; }
.diff-view pre { font-size: 11px; }
</style>
