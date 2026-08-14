<template>
  <div class="provider-tab">
    <div class="header">
      <div class="agent-switch">
        <button
          v-for="k in AGENT_KINDS"
          :key="k"
          class="agent-btn"
          :class="['a-' + k, { active: selectedAgent === k }]"
          @click="selectedAgent = k"
        >
          <AgentBadge :agent="k" size="sm" />
        </button>
      </div>
      <button class="add-btn" @click="onAdd">
        <Icon name="plus" :size="14" />
        <span>新增供应商</span>
      </button>
    </div>

    <div v-if="providers.length > 0" class="card-grid">
      <ProviderCard
        v-for="p in providers"
        :key="p.id"
        :provider="p"
        :is-active="p.id === activeId"
        @edit="openEdit(p)"
        @set-active="onSetActive(p.id)"
        @remove="onDelete(p)"
      />
      <button class="add-card" @click="onAdd">
        <Icon name="plus" :size="20" />
      </button>
    </div>
    <div v-else class="empty-state">
      <div class="empty-text">暂无供应商，点击上方「新增供应商」</div>
      <button class="add-card-empty" @click="onAdd">
        <Icon name="plus" :size="14" />
        <span>新增供应商</span>
      </button>
    </div>

    <ProviderDialog
      v-model="dialogOpen"
      :provider="editingProvider"
      :agent="selectedAgent"
      @save="onSave"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import Icon from '../../components/Icon.vue'
import AgentBadge from '../../components/AgentBadge.vue'
import ProviderCard from './ProviderCard.vue'
import ProviderDialog from './ProviderDialog.vue'
import { useProvidersStore } from '../../stores/providers'
import { pushToast } from '../../composables/useToast'
import { AGENT_KINDS } from '../../types/agents'
import type { Provider } from '../../types/providers'

const store = useProvidersStore()
const selectedAgent = ref('claude')
const dialogOpen = ref(false)
const editingProvider = ref<Provider | null>(null)

const allProviders = computed(() => store.cfg?.providers ?? [])
const providers = computed(() => allProviders.value.filter(p => (p.agent || 'claude') === selectedAgent.value))
const activeId = computed(() => store.activeIdFor(selectedAgent.value))

onMounted(async () => { await store.load() })

function onAdd() {
  editingProvider.value = null
  dialogOpen.value = true
}

function openEdit(p: Provider) {
  editingProvider.value = p
  dialogOpen.value = true
}

async function onSave(p: Provider) {
  // 新增：push；编辑：按 id 替换
  if (!store.cfg) return
  const idx = store.cfg.providers.findIndex(x => x.id === p.id)
  if (idx === -1) store.cfg.providers.push(p)
  else store.cfg.providers[idx] = p
  try {
    await store.save()
    pushToast({ level: 'info', source: 'provider', message: '保存成功' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '保存失败：' + (e?.message ?? e) })
  }
}

async function onSetActive(id: string) {
  try {
    await store.setActive(id)
    pushToast({ level: 'info', source: 'provider', message: '已切换为当前供应商' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '切换失败：' + (e?.message ?? e) })
  }
}

async function onDelete(p: Provider) {
  if (!confirm(`确定删除供应商「${p.name || '未命名'}」吗？`)) return
  try {
    await store.removeProvider(p.id)
    pushToast({ level: 'info', source: 'provider', message: '已删除' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '删除失败：' + (e?.message ?? e) })
  }
}
</script>

<style scoped>
.provider-tab { display: flex; flex-direction: column; height: 100%; }
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
}
.agent-switch { display: flex; gap: 6px; }
.agent-btn {
  width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-input); cursor: pointer;
}
.agent-btn:hover { border-color: var(--accent); }
.agent-btn.active { border-color: transparent; }
.agent-btn.a-claude.active { background: var(--agent-claude-bg); }
.agent-btn.a-codex.active { background: var(--agent-codex-bg); }
.agent-btn.a-opencode.active { background: var(--agent-opencode-bg); }
.agent-btn.a-omp.active { background: var(--agent-omp-bg); }
.add-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: var(--radius-md); font-size: 12px;
  border: 1px solid var(--border); background: var(--accent); color: var(--text-inverse); cursor: pointer;
}
.card-grid {
  flex: 1; overflow-y: auto; padding: 16px;
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; align-content: start;
}
.add-card {
  min-height: 96px; border: 1px dashed var(--border); border-radius: var(--radius-md);
  background: transparent; color: var(--text-tertiary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.add-card:hover { border-color: var(--accent); color: var(--accent-light); }
.empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
.empty-text { font-size: 13px; color: var(--text-tertiary); }
.add-card-empty {
  display: flex; align-items: center; gap: 4px;
  padding: 7px 16px; border-radius: var(--radius-md); font-size: 12px;
  border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); cursor: pointer;
}
</style>
