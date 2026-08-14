<template>
  <Teleport to="body">
    <div v-if="modelValue" class="dialog-mask" @click.self="$emit('update:modelValue', false)">
      <div class="dialog">
        <div class="dialog-head">
          <h3>{{ provider ? '编辑供应商' : '新增供应商' }}</h3>
          <button class="close" aria-label="关闭" @click="$emit('update:modelValue', false)">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div class="form-group">
          <label>名称</label>
          <input class="v" v-model="form.name" />
        </div>
        <div class="form-group">
          <label>Base URL</label>
          <input class="v" v-model="form.base_url" :placeholder="urlPlaceholder" @input="onUrlOrTokenInput" />
        </div>
        <div class="form-group">
          <label>Auth Token</label>
          <input class="v" type="password" v-model="form.auth_token" @input="onUrlOrTokenInput" />
        </div>
        <div class="form-group">
          <label>默认模型</label>
          <div class="combo-wrap">
            <input class="v" v-model="form.default_model" placeholder="留空则使用默认模型" @focus="activeModelField = 'model'" @blur="onComboBlur" />
            <div v-if="activeModelField === 'model' && availableModels.length > 0" class="combo-dropdown">
              <div v-for="m in availableModels" :key="m" class="combo-option" @mousedown.prevent="form.default_model = m; activeModelField = ''">
                {{ m }}
              </div>
            </div>
          </div>
        </div>

        <!-- claude 专属：模型细分 -->
        <template v-if="agent === 'claude'">
          <div v-for="f in claudeModelFields" :key="f.key" class="form-group">
            <label>{{ f.label }}</label>
            <div class="combo-wrap">
              <input class="v" :value="(form as any)[f.key]" @input="(e: any) => { (form as any)[f.key] = e.target.value; activeModelField = f.key }" @focus="activeModelField = f.key" @blur="onComboBlur" />
              <div v-if="activeModelField === f.key && availableModels.length > 0" class="combo-dropdown">
                <div v-for="m in availableModels" :key="m" class="combo-option" @mousedown.prevent="(form as any)[f.key] = m; activeModelField = ''">
                  {{ m }}
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- codex 专属：Provider 名 -->
        <div v-if="agent === 'codex'" class="form-group">
          <label>Provider 名 <small>model_providers 的 key</small></label>
          <input class="v" v-model="form.codex_provider" placeholder="lynel" />
        </div>

        <div class="dialog-foot">
          <button class="test" :disabled="!form.base_url" @click="onTest">测试连接</button>
          <div class="spacer" />
          <button @click="$emit('update:modelValue', false)">取消</button>
          <button class="save" @click="onSave">保存</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import Icon from '../../components/Icon.vue'
import type { Provider } from '../../types/providers'
import { TestProviderConnection, FetchProviderModels } from '../../composables/useElectron'
import { pushToast } from '../../composables/useToast'

const props = defineProps<{
  modelValue: boolean
  provider: Provider | null
  agent: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'save', provider: Provider): void
}>()

const claudeModelFields = [
  { key: 'default_haiku_model', label: 'Haiku默认模型' },
  { key: 'default_sonnet_model', label: 'Sonnet默认模型' },
  { key: 'default_opus_model', label: 'Opus默认模型' },
  { key: 'reasoning_model', label: '推理模型' },
]

const urlPlaceholder = props.agent === 'omp' ? 'https://api.deepseek.com' : 'https://api.anthropic.com'

function blank(): Provider {
  return {
    id: props.provider?.id ?? crypto.randomUUID(),
    agent: props.agent,
    name: props.provider?.name ?? '',
    base_url: props.provider?.base_url ?? '',
    auth_token: props.provider?.auth_token ?? '',
    default_model: props.provider?.default_model ?? '',
    default_haiku_model: props.provider?.default_haiku_model ?? '',
    default_sonnet_model: props.provider?.default_sonnet_model ?? '',
    default_opus_model: props.provider?.default_opus_model ?? '',
    reasoning_model: props.provider?.reasoning_model ?? '',
    codex_provider: props.provider?.codex_provider ?? 'lynel',
  }
}

const form = reactive<Provider>(blank())
const availableModels = ref<string[]>([])
const activeModelField = ref('')
let fetchTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.modelValue, (open) => {
  if (open) Object.assign(form, blank())
  activeModelField.value = ''
  availableModels.value = []
})

function onUrlOrTokenInput() {
  if (fetchTimer) clearTimeout(fetchTimer)
  const { base_url, auth_token } = form
  if (!base_url || !auth_token) { availableModels.value = []; return }
  fetchTimer = setTimeout(async () => {
    const r = await FetchProviderModels(base_url, auth_token)
    if (r.ok && r.models?.length) availableModels.value = r.models
  }, 600)
}

function onComboBlur() {
  setTimeout(() => { activeModelField.value = '' }, 150)
}

async function onTest() {
  const r = await TestProviderConnection(form.base_url, form.auth_token, form.default_model)
  if (r.ok) pushToast({ level: 'info', source: 'provider', message: '连接成功', duration: 3000 })
  else pushToast({ level: 'error', source: 'provider', message: '连接失败：' + (r.error || '未知错误'), duration: 5000 })
}

function onSave() {
  emit('save', { ...form })
  emit('update:modelValue', false)
}
</script>

<style scoped>
.dialog-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.dialog {
  width: 520px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
  background: var(--bg-window); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 20px;
}
.dialog-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.dialog-head h3 { margin: 0; font-size: 16px; }
.close { background: none; border: none; color: var(--text-tertiary); cursor: pointer; padding: 4px; }
.form-group { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; }
.form-group label { width: 150px; font-size: 12px; color: var(--text-primary); padding-top: 7px; flex-shrink: 0; }
.form-group label small { display: block; color: var(--text-tertiary); font-size: 11px; margin-top: 2px; }
.form-group input.v {
  flex: 1; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px; color: var(--text-primary);
  font-size: 12px; font-family: inherit;
}
.form-group input.v[type="password"] { font-family: var(--font-mono); }
.combo-wrap { position: relative; flex: 1; }
.combo-dropdown {
  position: absolute; top: 100%; left: 0; right: 0; max-height: 200px; overflow-y: auto;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 0 0 var(--radius-md) var(--radius-md); z-index: 50; box-shadow: var(--shadow-window);
}
.combo-option { padding: 6px 10px; font-size: 12px; cursor: pointer; }
.combo-option:hover { background: var(--accent-soft-bg); color: var(--accent-light); }
.dialog-foot { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.dialog-foot .spacer { flex: 1; }
.dialog-foot button {
  padding: 7px 16px; border-radius: var(--radius-md); font-size: 12px;
  border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); cursor: pointer;
}
.dialog-foot button.save { background: var(--accent); border-color: var(--accent); color: var(--text-inverse); }
.dialog-foot button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
