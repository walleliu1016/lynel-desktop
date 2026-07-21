<template>
  <section class="detail-pane">
    <div v-if="diffResult && diffResult.counts" class="diff-view">
      <div class="cards">
        <div class="card"> <div class="k">added</div><div class="v add">+{{ diffResult.counts.added }}</div><small>blocks</small></div>
        <div class="card"> <div class="k">removed</div><div class="v del">-{{ diffResult.counts.removed }}</div><small>blocks</small></div>
        <div class="card"> <div class="k">unchanged</div><div class="v">{{ diffResult.counts.common }}</div><small>blocks</small></div>
        <div class="card" v-if="diffResult.counts.cachedInB > 0"> <div class="k">cached in B</div><div class="v">{{ diffResult.counts.cachedInB }}</div><small>blocks</small></div>
      </div>
      <p class="diff-hint">Comparing <b>#{{ diffResult.a.seq }}</b> &rarr; <b>#{{ diffResult.b.seq }}</b> (later B vs earlier A)</p>
      <div v-if="diffResult.added?.length" class="diff-section add">+ Added in B</div>
      <div v-for="(x, i) in (diffResult.added || [])" :key="'a'+i" class="diff-block add">
        <div class="h"><span>{{ x.label }}</span><span v-if="x.cache" class="tag cache">cache</span></div>
        <FoldingPre :text="(x.text || '').slice(0, 4000)" />
      </div>
      <p v-if="!diffResult.added?.length" class="diff-empty">nothing added</p>
      <div v-if="diffResult.removed?.length" class="diff-section del">- Removed since A</div>
      <div v-for="(x, i) in (diffResult.removed || [])" :key="'r'+i" class="diff-block del">
        <div class="h"><span>{{ x.label }}</span></div>
        <FoldingPre :text="(x.text || '').slice(0, 4000)" />
      </div>
      <p v-if="!diffResult.removed?.length" class="diff-empty">nothing removed</p>
    </div>
    <div v-else-if="loading && !detail" class="loading-skeleton">
      <div class="skeleton-card" v-for="i in 4" :key="i">
        <div class="skeleton-line short" />
        <div class="skeleton-line long" />
      </div>
    </div>
    <div v-else-if="!detail" class="empty">选中左侧请求查看详情</div>
    <div v-else class="tabs">
      <div class="tab-bar">
        <button v-for="t in tabs" :key="t" :class="{ on: activeTab === t }" @click="activeTab = t">
          {{ t }}
        </button>
        <span class="spacer" />
      </div>
      <Transition name="tab-fade" mode="out-in">
        <OverviewPane v-if="activeTab === 'overview'" :key="'overview'" :detail="detail" />
        <MessagesPane v-else-if="activeTab === 'messages'" :key="'messages'" :detail="detail" />
        <ToolsPane v-else-if="activeTab === 'tools'" :key="'tools'" :detail="detail" />
        <ResponsePane v-else-if="activeTab === 'response'" :key="'response'" :detail="detail" />
        <SystemPane v-else-if="activeTab === 'system'" :key="'system'" :detail="detail" />
        <HeadersPane v-else-if="activeTab === 'headers'" :key="'headers'" :detail="detail" />
        <FlowPane v-else-if="activeTab === 'flow'" :key="'flow'" :detail="detail" />
      </Transition>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import FoldingPre from './FoldingPre.vue'
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
  loading?: boolean
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
.loading-skeleton { padding: 24px 18px; display: flex; flex-direction: column; gap: 16px; }
.skeleton-card { display: flex; flex-direction: column; gap: 8px; }
.skeleton-line { height: 14px; border-radius: 3px; background: var(--bg-input); animation: pulse-opacity 1.5s ease-in-out infinite; }
.skeleton-line.short { width: 35%; }
.skeleton-line.long { width: 70%; }
@keyframes pulse-opacity { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.7; } }
@media (prefers-reduced-motion: reduce) { .skeleton-line { animation: none; opacity: 0.4; } }
.tabs { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.tab-bar { display: flex; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--border); }
.tab-bar button { background: transparent; border: 1px solid transparent; padding: 4px 12px; cursor: pointer; border-radius: 6px 6px 0 0; font-size: 12px; color: var(--text-tertiary); transition: background 120ms, color 120ms, border-color 120ms; }
.tab-bar button.on { background: var(--bg-card, rgba(0,0,0,0.03)); border-color: var(--border); color: var(--text-primary); }
.tab-bar .spacer { flex: 1; }
.tab-fade-enter-active, .tab-fade-leave-active { transition: opacity 120ms; }
.tab-fade-enter-from, .tab-fade-leave-to { opacity: 0; }

/* diff */
.diff-view { padding: 20px 18px; overflow: auto; }
.cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.card { background: var(--bg-input); border: 1px solid var(--border); border-left: 3px solid var(--border); border-radius: var(--radius-md); padding: 10px 14px; min-width: 120px; }
.card .k { color: var(--text-tertiary); font-size: 11px; text-transform: uppercase; }
.card .v { font-size: 20px; font-weight: 700; font-family: var(--font-mono); }
.card:nth-child(1) { border-left-color: var(--status-success); }
.card:nth-child(2) { border-left-color: var(--status-error); }
.card:nth-child(4) { border-left-color: var(--status-warn); }
.card .v.add { color: var(--status-success); }
.card .v.del { color: var(--status-error); }
.card small { font-size: 12px; color: var(--text-tertiary); font-weight: 400; }
.diff-hint { color: var(--text-tertiary); margin: 0 0 12px; font-size: 12px; }
.diff-hint b { color: var(--text-primary); }
.diff-section { margin: 18px 0 8px; font-weight: 700; font-size: 13px; }
.diff-section.add { color: var(--status-success); }
.diff-section.del { color: var(--status-error); }
.diff-block { margin-bottom: 10px; border: 1px solid var(--border); border-radius: 4px; }
.diff-block.add { border-left: 3px solid var(--status-success); }
.diff-block.del { border-left: 3px solid var(--status-error); opacity: .7; }
.diff-block .h {
  padding: 6px 12px; background: var(--bg-input); display: flex;
  justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-secondary);
  font-family: var(--font-mono);
}
.tag {
  padding: 1px 6px; border-radius: 8px; font-size: 10px;
  font-family: var(--font-mono);
}
.tag.cache { background: var(--status-warn); color: var(--bg-primary); }
.diff-empty { color: var(--text-tertiary); font-size: 12px; padding: 8px 0; }
</style>
