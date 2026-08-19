<template>
  <div class="provider-tab">
    <div class="provider-body">
      <nav class="agent-menu">
        <button
          v-for="k in settings.enabledAgentKinds"
          :key="k"
          class="agent-menu-item"
          :class="['a-' + k, { active: selectedAgent === k }]"
          @click="selectedAgent = k"
        >
          <AgentBadge :agent="k" size="sm" />
          <span>{{ agentMeta(k).short }}</span>
        </button>
      </nav>

      <div class="provider-main">
        <div v-if="providers.length > 0" class="card-grid">
          <ProviderCard
            v-for="p in providers"
            :key="p.id"
            :provider="p"
            :is-active="p.id === activeId"
            @edit="openEdit(p)"
            @copy="onCopy(p)"
            @set-active="onSetActive(p.id)"
            @remove="onDelete(p)"
          />
          <button class="add-card" @click="onAdd">
            <Icon name="plus" :size="20" />
          </button>
        </div>
        <div v-else class="empty-state">
          <div class="empty-text">暂无供应商</div>
          <button class="add-card-empty" @click="onAdd">
            <Icon name="plus" :size="14" />
            <span>新增供应商</span>
          </button>
        </div>
      </div>
    </div>

    <ProviderDialog
      v-model="dialogOpen"
      :provider="editingProvider"
      :agent="selectedAgent"
      @save="onSave"
    />

    <ConfirmDialog
      :open="showDeleteDialog"
      title="删除供应商"
      :message="`确定删除供应商「${deleteTarget?.name || '未命名'}」吗？`"
      confirm-text="删除"
      :danger="true"
      @confirm="confirmDelete"
      @cancel="showDeleteDialog = false"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import Icon from '../../components/Icon.vue'
import AgentBadge from '../../components/AgentBadge.vue'
import ProviderCard from './ProviderCard.vue'
import ProviderDialog from './ProviderDialog.vue'
import ConfirmDialog from '../../components/ConfirmDialog.vue'
import { useProvidersStore } from '../../stores/providers'
import { useSettingsStore } from '../../stores/settings'
import { pushToast } from '../../composables/useToast'
import { agentMeta, type AgentKind } from '../../types/agents'
import type { Provider } from '../../types/providers'

const store = useProvidersStore()
const settings = useSettingsStore()
const selectedAgent = ref<AgentKind>('claude')
const dialogOpen = ref(false)
const editingProvider = ref<Provider | null>(null)
const showDeleteDialog = ref(false)
const deleteTarget = ref<Provider | null>(null)

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

async function onCopy(p: Provider) {
  if (!store.cfg) return
  const copy: Provider = {
    ...JSON.parse(JSON.stringify(p)),
    id: crypto.randomUUID(),
    name: (p.name || '未命名供应商') + '-copy',
  }
  store.cfg.providers.push(copy)
  try {
    await store.save()
    pushToast({ level: 'info', source: 'provider', message: '已复制，请修改配置' })
    openEdit(copy)
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '复制失败：' + (e?.message ?? e) })
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

function onDelete(p: Provider) {
  deleteTarget.value = p
  showDeleteDialog.value = true
}

async function confirmDelete() {
  const p = deleteTarget.value
  if (!p) return
  showDeleteDialog.value = false
  deleteTarget.value = null
  try {
    await store.removeProvider(p.id)
    pushToast({ level: 'info', source: 'provider', message: '已删除' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '删除失败：' + (e?.message ?? e) })
  }
}

// 选中的 agent 被开关隐藏时回退 claude
watch(() => settings.enabledAgentKinds, (kinds) => {
  if (!kinds.includes(selectedAgent.value)) selectedAgent.value = 'claude'
})
</script>

<style scoped>
.provider-tab { display: flex; flex-direction: column; height: 100%; }
.provider-body { flex: 1; min-height: 0; display: flex; }
.agent-menu {
  width: 148px; flex-shrink: 0; border-right: 1px solid var(--border);
  padding: 12px 10px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto;
}
.agent-menu-item {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 8px 10px; font-size: 12px; font-weight: 600;
  border: 1px solid transparent; border-radius: var(--radius-md);
  background: transparent; color: var(--text-secondary); cursor: pointer;
  font-family: inherit; text-align: left;
}
.agent-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.agent-menu-item.a-claude.active { color: var(--agent-claude-fg); }
.agent-menu-item.a-codex.active { color: var(--agent-codex-fg); }
.agent-menu-item.a-opencode.active { color: var(--agent-opencode-fg); }
.agent-menu-item.a-omp.active { color: var(--agent-omp-fg); }
.provider-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.card-grid {
  flex: 1; overflow-y: auto; padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px; align-content: start;
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
