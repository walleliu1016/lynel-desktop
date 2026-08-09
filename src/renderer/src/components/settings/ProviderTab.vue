<template>
  <div class="provider-tab">
    <aside class="provider-list">
      <div class="list-header">
        <span>模型供应商</span>
        <button class="add-btn" aria-label="新增供应商" title="新增供应商" @click="onAdd">
          <Icon name="plus" :size="14" />
        </button>
      </div>
      <div class="agent-switch">
        <button
          v-for="k in AGENT_KINDS"
          :key="k"
          class="agent-btn"
          :class="{ active: selectedAgent === k }"
          @click="onSwitchAgent(k)"
        >{{ agentMeta(k).abbr }}</button>
      </div>
      <div class="list">
        <div
          v-for="p in providers"
          :key="p.id"
          class="provider-item"
          :class="{ active: p.id === selectedId, current: p.id === activeId }"
          @click="selectedId = p.id"
        >
          <span class="dot" />
          <div class="info">
            <div class="name">{{ p.name || '未命名供应商' }}</div>
            <div class="url">{{ p.base_url || '未设置 Base URL' }}</div>
          </div>
          <span v-if="p.id === activeId" class="badge">当前</span>
        </div>
      </div>
    </aside>

    <section v-if="provider" class="provider-form">
      <div class="form-header">
        <h3>编辑供应商</h3>
        <div class="form-actions-top">
          <button class="danger" :disabled="providers.length <= 1" @click="onDelete">删除</button>
          <button class="primary" :disabled="provider.id === activeId" @click="onSetActive">设为当前</button>
        </div>
      </div>

      <div class="form-group">
        <label>名称</label>
        <input class="v" v-model="provider.name" @input="markDirty" />
      </div>
      <div class="form-group">
        <label>Base URL <small>ANTHROPIC_BASE_URL</small></label>
        <input class="v" v-model="provider.base_url" @input="onUrlOrTokenInput" placeholder="https://api.anthropic.com" />
      </div>
      <div class="form-group">
        <label>Auth Token <small>ANTHROPIC_AUTH_TOKEN</small></label>
        <input class="v" type="password" v-model="provider.auth_token" @input="onUrlOrTokenInput" />
      </div>

      <div v-for="f in modelFields" :key="f.key" class="form-group">
        <label>{{ f.label }} <small>{{ f.env }}</small></label>
        <div class="combo-wrap">
          <input
            class="v"
            :value="(provider as any)[f.key]"
            :placeholder="f.placeholder || modelPlaceholder"
            @input="(e: any) => { (provider as any)[f.key] = e.target.value; markDirty(); activeModelField = f.key }"
            @focus="activeModelField = f.key"
            @blur="onComboBlur(f.key)"
          />
          <div v-if="activeModelField === f.key && availableModels.length > 0" class="combo-dropdown">
            <div
              v-for="m in availableModels.filter(m => !(provider as any)[f.key] || m.toLowerCase().includes((provider as any)[f.key].toLowerCase()))"
              :key="m"
              class="combo-option"
              @mousedown.prevent="selectModel(f.key, m)"
            >
              {{ m }}
            </div>
          </div>
        </div>
      </div>

      <div class="hint">
        推理模型用于 thinking / extended thinking 场景，和普通模型分开配置。
        Haiku / Sonnet / Opus 默认模型留空时，将使用上方"默认模型"的值。
      </div>

      <div class="bottom-actions">
        <button @click="onTest" :disabled="!provider.base_url">测试连接</button>
        <div class="spacer" />
        <button :disabled="!dirty" @click="onCancel">取消</button>
        <button class="save" :disabled="!dirty" @click="onSave">保存</button>
      </div>
    </section>

    <section v-else class="provider-form empty-state">
      <div class="empty-text">{{ emptyStateText }}</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import Icon from '../../components/Icon.vue'
import { useProvidersStore } from '../../stores/providers'
import { TestProviderConnection, FetchProviderModels } from '../../composables/useElectron'
import { pushToast } from '../../composables/useToast'
import { AGENT_KINDS, agentMeta } from '../../types/agents'

const store = useProvidersStore()
const selectedId = ref('')
const selectedAgent = ref('claude')

const allProviders = computed(() => store.cfg?.providers ?? [])
const providers = computed(() => allProviders.value.filter(p => (p.agent || 'claude') === selectedAgent.value))
const emptyStateText = computed(() =>
  selectedAgent.value === 'claude'
    ? '暂无供应商，点击左上角 + 新增'
    : '该 agent 的供应商配置待支持',
)
const activeId = computed(() => store.cfg?.active_provider_id ?? '')
const dirty = computed(() => store.dirty)
const provider = computed(() => providers.value.find(p => p.id === selectedId.value))
const modelPlaceholder = computed(() => provider.value?.default_model ? `留空则使用默认模型：${provider.value.default_model}` : '留空则使用默认模型')

const availableModels = ref<string[]>([])
const fetchingModels = ref(false)
const activeModelField = ref('') // 当前展开下拉的 model 字段名

// 用户主动编辑 URL/Token 时才触发拉取（切换供应商不触发）
let fetchTimer: ReturnType<typeof setTimeout> | null = null
function onUrlOrTokenInput() {
  markDirty()
  if (fetchTimer) clearTimeout(fetchTimer)
  const url = provider.value?.base_url
  const token = provider.value?.auth_token
  if (!url || !token) { availableModels.value = []; return }
  fetchTimer = setTimeout(() => fetchModels(), 600)
}

// 切换供应商时清空模型列表，避免显示上一个供应商的列表
watch(selectedId, () => {
  availableModels.value = []
  if (fetchTimer) { clearTimeout(fetchTimer); fetchTimer = null }
})

// 切换 agent 分组：选中该分组第一个 provider（无则清空），并清空模型下拉状态
function onSwitchAgent(k: string) {
  selectedAgent.value = k
  activeModelField.value = ''
  const group = allProviders.value.filter(p => (p.agent || 'claude') === k)
  selectedId.value = group.length > 0 ? group[0].id : ''
}

async function fetchModels() {
  if (!provider.value?.base_url) return
  fetchingModels.value = true
  try {
    const result = await FetchProviderModels(provider.value.base_url, provider.value.auth_token || '')
    if (result.ok && result.models?.length) {
      availableModels.value = result.models
      pushToast({ level: 'info', source: 'provider', message: `已获取 ${result.models.length} 个模型`, duration: 3000 })
    } else {
      availableModels.value = []
      pushToast({ level: 'error', source: 'provider', message: '获取模型列表失败，请手动输入模型名称', duration: 5000 })
    }
  } catch {
    availableModels.value = []
    pushToast({ level: 'error', source: 'provider', message: '获取模型列表失败，请手动输入模型名称', duration: 5000 })
  } finally {
    fetchingModels.value = false
  }
}

function toggleModelDropdown(field: string) {
  activeModelField.value = activeModelField.value === field ? '' : field
}

function selectModel(field: string, model: string) {
  if (!provider.value) return
  ;(provider.value as any)[field] = model
  activeModelField.value = ''
  markDirty()
}

const modelFields = [
  { key: 'default_model', label: '默认模型', env: 'ANTHROPIC_MODEL', placeholder: 'claude-sonnet-4-6-20251101' },
  { key: 'default_haiku_model', label: 'Haiku默认模型', env: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', placeholder: '' },
  { key: 'default_sonnet_model', label: 'Sonnet默认模型', env: 'ANTHROPIC_DEFAULT_SONNET_MODEL', placeholder: '' },
  { key: 'default_opus_model', label: 'Opus默认模型', env: 'ANTHROPIC_DEFAULT_OPUS_MODEL', placeholder: '' },
  { key: 'reasoning_model', label: '推理模型', env: 'ANTHROPIC_REASONING_MODEL', placeholder: 'claude-opus-4-7-20260201' },
]


onMounted(async () => {
  await store.load()
  const active = store.cfg?.active_provider_id
  if (providers.value.length > 0) {
    selectedId.value = providers.value.some(p => p.id === active) ? active! : providers.value[0].id
  }
})

function markDirty() { store.markDirty() }

async function onAdd() {
  try {
    selectedId.value = await store.addProvider(selectedAgent.value)
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '新增失败：' + (e?.message ?? e) })
  }
}

async function onDelete() {
  if (!provider.value) return
  if (!confirm(`确定删除供应商「${provider.value.name || '未命名'}」吗？`)) return
  try {
    await store.removeProvider(selectedId.value)
    // 删除后按当前分组重选：组内 active 优先，否则组内第一个
    const remaining = allProviders.value.filter((p) => (p.agent || 'claude') === selectedAgent.value)
    const activeInGroup = remaining.find((p) => p.id === store.cfg?.active_provider_id)
    selectedId.value = activeInGroup?.id ?? remaining[0]?.id ?? ''
    pushToast({ level: 'info', source: 'provider', message: '已删除' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '删除失败：' + (e?.message ?? e) })
  }
}

async function onSetActive() {
  if (!provider.value) return
  try {
    await store.setActive(provider.value.id)
    pushToast({ level: 'info', source: 'provider', message: '已切换为当前供应商' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '切换失败：' + (e?.message ?? e) })
  }
}

async function onSave() {
  try {
    await store.save()
    pushToast({ level: 'info', source: 'provider', message: '保存成功' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '保存失败：' + (e?.message ?? e) })
  }
}

async function onCancel() {
  await store.load()
  if (providers.value.length > 0 && !providers.value.find(p => p.id === selectedId.value)) {
    const active = store.cfg?.active_provider_id
    selectedId.value = providers.value.some(p => p.id === active) ? active! : providers.value[0].id
  }
}

function onComboBlur(field: string) {
  setTimeout(() => {
    if (activeModelField.value === field) activeModelField.value = ''
  }, 150)
}

async function onTest() {
  if (!provider.value) return
  const { base_url, auth_token, default_model } = provider.value
  if (!base_url) return
  pushToast({ level: 'info', source: 'provider', message: '正在测试连接...', duration: 5000 })
  const result = await TestProviderConnection(base_url, auth_token || '', default_model || '')
  if (result.ok) {
    const fmt = (result as any).format === 'openai' ? 'OpenAI' : 'Anthropic'
    const warn = (result as any).warning
    if (warn) {
      pushToast({ level: 'error', source: 'provider', message: `连接成功（${fmt} 格式）⚠️ ${warn}`, duration: 8000 })
    } else {
      pushToast({ level: 'info', source: 'provider', message: `连接成功（${fmt} 格式）`, duration: 5000 })
    }
  } else {
    pushToast({ level: 'error', source: 'provider', message: '连接失败：' + (result.error || '未知错误'), duration: 8000 })
  }
}

</script>

<style scoped>
.provider-tab { display: flex; height: 100%; }
.provider-list {
  width: 220px; background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column; flex-shrink: 0;
}
.list-header {
  padding: 14px 16px; border-bottom: 1px solid var(--border);
  font-weight: 600; display: flex; justify-content: space-between; align-items: center;
}
.agent-switch {
  display: flex; gap: 6px; padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.agent-btn {
  flex: 1; padding: 5px 0; font-size: 11px; font-weight: 600;
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-input); color: var(--text-tertiary); cursor: pointer;
  text-align: center;
}
.agent-btn:hover { border-color: var(--accent); color: var(--text-primary); }
.agent-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.add-btn {
  width: 24px; height: 24px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg-input);
  color: var(--text-primary); cursor: pointer; display: flex;
  align-items: center; justify-content: center;
}
.add-btn:hover { border-color: var(--accent); color: var(--accent-light); }
.list { flex: 1; overflow-y: auto; padding: 8px; }
.provider-item {
  padding: 10px 12px; border-radius: var(--radius-md);
  cursor: pointer; margin-bottom: 4px;
  display: flex; align-items: center; gap: 10px;
  border: 1px solid transparent;
}
.provider-item:hover { background: var(--bg-input); }
.provider-item:active { background: var(--border); }
.provider-item.active { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); }
.provider-item .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
.provider-item.current .dot { background: var(--status-success); box-shadow: 0 0 6px var(--status-success); }
.provider-item .info { flex: 1; min-width: 0; }
.provider-item .name { font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.provider-item.active .name { color: var(--accent-light); font-weight: 600; }
.provider-item .url { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.provider-item .badge { font-size: 10px; padding: 2px 6px; border-radius: var(--radius-sm); background: var(--accent); color: #fff; font-weight: 600; }
.provider-form { flex: 1; padding: 20px 24px; display: flex; flex-direction: column; min-width: 0; overflow-y: auto; }
.provider-form.empty-state { align-items: center; justify-content: center; }
.empty-text { font-size: 13px; color: var(--text-tertiary); text-align: center; line-height: 1.6; }
.form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.form-header h3 { margin: 0; font-size: 16px; }
.form-actions-top button { padding: 5px 12px; font-size: 12px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); cursor: pointer; margin-left: 8px; }
.form-actions-top button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.form-actions-top button.danger { color: var(--status-error); border-color: var(--status-error); }
.form-actions-top button:disabled { opacity: 0.4; cursor: not-allowed; }
.form-group { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
.form-group label { width: 170px; font-size: 12px; color: var(--text-primary); padding-top: 7px; flex-shrink: 0; }
.form-group label small { display: block; color: var(--text-tertiary); font-size: 11px; margin-top: 2px; }
.form-group input.v {
  flex: 1; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
  width: 100%;
}
.form-group input.v:focus { outline: none; border-color: var(--accent); }
.form-group input.v[type="password"] { font-family: var(--font-mono); }

.combo-wrap { position: relative; flex: 1; }
.combo-dropdown {
  position: absolute; top: 100%; left: 0; right: 0;
  max-height: 200px; overflow-y: auto;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  z-index: 50; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
.combo-option {
  padding: 6px 10px; font-size: 12px; color: var(--text-primary);
  cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.combo-option:hover { background: var(--accent-soft-bg); color: var(--accent-light); }
.hint {
  margin-top: auto; padding: 10px 14px; background: var(--accent-soft-bg);
  border: 1px solid var(--accent-soft-border); border-radius: var(--radius-md);
  font-size: 12px; color: var(--text-secondary); line-height: 1.5;
}
.bottom-actions { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.bottom-actions .spacer { flex: 1; }
.bottom-actions button {
  padding: 7px 16px; border-radius: var(--radius-md); font-size: 12px;
  border: 1px solid var(--border); background: var(--bg-input);
  color: var(--text-primary); cursor: pointer;
}
.bottom-actions button.save { background: var(--accent); border-color: var(--accent); color: #fff; }
.bottom-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
