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
  <div class="feishu-config">
    <div class="form-group">
      <label class="form-label">启用</label>
      <Switch :modelValue="cfg.enabled" @update:modelValue="setEnabled" />
    </div>

    <div class="form-group">
      <label class="form-label">Webhook URL</label>
      <input class="form-input" v-model="cfg.webhookUrl" placeholder="飞书机器人 Webhook 地址" :disabled="disabled" />
    </div>

    <div class="form-group">
      <label class="form-label">签名密钥</label>
      <input class="form-input" type="password" v-model="cfg.secret" placeholder="飞书机器人签名校验密钥（可选）" :disabled="disabled" />
    </div>

    <p class="placeholder-hint">飞书通道即将上线，敬请期待。</p>
  </div>
</template>

<style scoped>
.feishu-config { padding: 0; }
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
.placeholder-hint { font-size: 12px; color: var(--text-tertiary); margin-top: 8px; padding: 10px; background: var(--bg-panel); border-radius: var(--radius-md); text-align: center; }
</style>
