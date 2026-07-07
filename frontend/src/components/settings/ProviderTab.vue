<template>
  <div class="provider-tab">
    <aside class="provider-list">
      <div class="list-header">
        <span>模型供应商</span>
        <button class="add-btn" @click="onAdd" title="新增供应商">
          <Icon name="plus" :size="14" />
        </button>
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
        <input class="v" v-model="provider.base_url" @input="markDirty" placeholder="https://api.anthropic.com" />
      </div>
      <div class="form-group">
        <label>Auth Token <small>ANTHROPIC_AUTH_TOKEN</small></label>
        <input class="v" type="password" v-model="provider.auth_token" @input="markDirty" />
      </div>
      <div class="form-group">
        <label>默认模型 <small>ANTHROPIC_MODEL</small></label>
        <input class="v" v-model="provider.default_model" @input="markDirty" placeholder="claude-sonnet-4-6-20251101" />
      </div>
      <div class="form-group">
        <label>Haiku默认模型 <small>ANTHROPIC_DEFAULT_HAIKU_MODEL</small></label>
        <input class="v" v-model="provider.default_haiku_model" @input="markDirty" :placeholder="modelPlaceholder" />
      </div>
      <div class="form-group">
        <label>Sonnet默认模型 <small>ANTHROPIC_DEFAULT_SONNET_MODEL</small></label>
        <input class="v" v-model="provider.default_sonnet_model" @input="markDirty" :placeholder="modelPlaceholder" />
      </div>
      <div class="form-group">
        <label>Opus默认模型 <small>ANTHROPIC_DEFAULT_OPUS_MODEL</small></label>
        <input class="v" v-model="provider.default_opus_model" @input="markDirty" :placeholder="modelPlaceholder" />
      </div>
      <div class="form-group">
        <label>推理模型 <small>ANTHROPIC_REASONING_MODEL</small></label>
        <input class="v" v-model="provider.reasoning_model" @input="markDirty" placeholder="claude-opus-4-7-20260201" />
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import Icon from '../../components/Icon.vue'
import { useProvidersStore } from '../../stores/providers'
import { showToast } from '../../composables/useToast'

const store = useProvidersStore()
const selectedId = ref('')

const providers = computed(() => store.cfg?.providers ?? [])
const activeId = computed(() => store.cfg?.active_provider_id ?? '')
const dirty = computed(() => store.dirty)
const provider = computed(() => providers.value.find(p => p.id === selectedId.value))
const modelPlaceholder = computed(() => provider.value?.default_model ? `留空则使用默认模型：${provider.value.default_model}` : '留空则使用默认模型')

onMounted(async () => {
  await store.load()
  if (providers.value.length > 0) {
    selectedId.value = store.cfg?.active_provider_id ?? providers.value[0].id
  }
})

function markDirty() { store.markDirty() }

function onAdd() {
  selectedId.value = store.addProvider()
}

function onDelete() {
  if (!provider.value) return
  if (!confirm(`确定删除供应商「${provider.value.name || '未命名'}」吗？`)) return
  selectedId.value = store.removeProvider(selectedId.value)
}

function onSetActive() {
  if (!provider.value) return
  store.setActive(provider.value.id)
}

async function onSave() {
  try {
    await store.save()
    showToast('保存成功')
  } catch (e: any) {
    showToast('保存失败：' + (e?.message ?? e), 'error')
  }
}

async function onCancel() {
  await store.load()
  if (providers.value.length > 0 && !providers.value.find(p => p.id === selectedId.value)) {
    selectedId.value = store.cfg?.active_provider_id ?? providers.value[0].id
  }
}

function onTest() {
  alert('连接测试暂未实现')
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
.provider-item.active { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); }
.provider-item .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
.provider-item.current .dot { background: var(--status-success); box-shadow: 0 0 6px var(--status-success); }
.provider-item .info { flex: 1; min-width: 0; }
.provider-item .name { font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.provider-item.active .name { color: var(--accent-light); font-weight: 600; }
.provider-item .url { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.provider-item .badge { font-size: 10px; padding: 2px 6px; border-radius: var(--radius-sm); background: var(--accent); color: #fff; font-weight: 600; }
.provider-form { flex: 1; padding: 20px 24px; display: flex; flex-direction: column; min-width: 0; overflow-y: auto; }
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
}
.form-group input.v:focus { outline: none; border-color: var(--accent); }
.form-group input.v[type="password"] { font-family: var(--font-mono); }
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
