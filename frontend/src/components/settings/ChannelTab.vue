<template>
  <div class="channel-tab">
    <h2>通道设置</h2>

    <div class="form-group">
      <label class="form-label">启用企业微信推送</label>
      <Switch v-model="cfg.enabled" @change="markDirty" />
    </div>

    <div class="form-group">
      <label class="form-label">Chat ID</label>
      <input
        class="form-input"
        v-model="cfg.chatId"
        @input="markDirty"
        placeholder="单聊填 userid，群聊填 chatid"
        :disabled="saving"
      />
      <p class="form-hint">目标会话 ID，单聊为成员 userid，群聊为群 chatid。</p>
    </div>

    <div class="form-group">
      <label class="form-label">Bot ID</label>
      <input
        class="form-input"
        v-model="cfg.botId"
        @input="markDirty"
        placeholder="企业微信机器人 ID"
        :disabled="saving"
      />
    </div>

    <div class="form-group">
      <label class="form-label">Secret</label>
      <input
        class="form-input"
        type="password"
        v-model="cfg.secret"
        @input="markDirty"
        placeholder="企业微信机器人 Secret"
        :disabled="saving"
      />
    </div>

    <div class="actions">
      <div class="spacer" />
      <button class="btn-cancel" :disabled="!dirty || saving" @click="onCancel">取消</button>
      <button class="btn-save" :disabled="!dirty || saving" @click="onSave">
        {{ saving ? '保存中...' : '保存' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import Switch from '../../components/Switch.vue'
import { GetWeComConfig, UpdateWeComConfig } from '../../composables/useElectron'
import { showToast } from '../../composables/useToast'

interface WeComConfig {
  enabled: boolean
  chatId: string
  botId: string
  secret: string
}

function defaultConfig(): WeComConfig {
  return {
    enabled: false,
    chatId: '',
    botId: '',
    secret: '',
  }
}

const cfg = reactive<WeComConfig>(defaultConfig())
const dirty = ref(false)
const saving = ref(false)

onMounted(async () => {
  await load()
})

async function load() {
  try {
    const raw = (await GetWeComConfig()) as Partial<WeComConfig> | null
    Object.assign(cfg, defaultConfig(), raw || {})
    dirty.value = false
  } catch (e: any) {
    showToast('加载配置失败：' + (e?.message ?? e), 'error')
  }
}

function markDirty() {
  dirty.value = true
}

async function onSave() {
  saving.value = true
  try {
    await UpdateWeComConfig({ ...cfg })
    dirty.value = false
    showToast('保存成功')
  } catch (e: any) {
    showToast('保存失败：' + (e?.message ?? e), 'error')
  } finally {
    saving.value = false
  }
}

async function onCancel() {
  await load()
}
</script>

<style scoped>
.channel-tab { padding: 20px 24px; max-width: 560px; }
h2 { font-size: 16px; color: var(--text-primary); font-weight: 600; margin-bottom: 20px; }

.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
.form-input {
  width: 100%; background: var(--bg-input); border:  1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: 13px; font-family: inherit;
}
.form-input:focus { outline: none; border-color: var(--accent); }
.form-input::placeholder { color: var(--text-tertiary); }
.form-input:disabled { opacity: 0.6; }
.form-input[type="password"] { font-family: var(--font-mono); }
.form-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }

.actions { display: flex; align-items: center; gap: 8px; margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border); }
.spacer { flex: 1; }
.btn-save { padding: 7px 20px; background: var(--accent); color: white; border: none; border-radius: var(--radius-md); font-size: 12px; font-weight: 500; cursor: pointer; }
.btn-save:hover:not(:disabled) { background: var(--accent-deep); }
.btn-cancel { padding: 7px 16px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }
.btn-cancel:hover:not(:disabled) { background: var(--border); }
.btn-save:disabled, .btn-cancel:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
