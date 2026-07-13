<script setup lang="ts">
import { computed } from 'vue'
import Switch from '../../components/Switch.vue'

const props = defineProps<{ modelValue: any; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: any): void; (e: 'dirty'): void }>()

const cfg = computed({
  get: () => props.modelValue,
  set: (v) => { emit('update:modelValue', v); emit('dirty') },
})

function setEnabled(v: boolean) {
  cfg.value = { ...cfg.value, enabled: v }
  emit('dirty')
}
</script>

<template>
  <div class="wecom-config">
    <div class="form-group">
      <label class="form-label">启用</label>
      <Switch :modelValue="cfg.enabled" @update:modelValue="setEnabled" />
    </div>

    <div class="form-group">
      <label class="form-label">Chat ID</label>
      <input class="form-input" v-model="cfg.chatId" placeholder="单聊填 userid，群聊填 chatid" :disabled="disabled" />
      <p class="form-hint">目标会话 ID，单聊为成员 userid，群聊为群 chatid。</p>
    </div>

    <div class="form-group">
      <label class="form-label">Bot ID</label>
      <input class="form-input" v-model="cfg.botId" placeholder="企业微信机器人 ID" :disabled="disabled" />
    </div>

    <div class="form-group">
      <label class="form-label">Secret</label>
      <input class="form-input" type="password" v-model="cfg.secret" placeholder="企业微信机器人 Secret" :disabled="disabled" />
    </div>
  </div>
</template>

<style scoped>
.wecom-config { padding: 0; }
.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
.form-input {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: 13px; font-family: inherit;
}
.form-input:focus { outline: none; border-color: var(--accent); }
.form-input::placeholder { color: var(--text-tertiary); }
.form-input:disabled { opacity: 0.6; }
.form-input[type="password"] { font-family: var(--font-mono); }
.form-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }
</style>
