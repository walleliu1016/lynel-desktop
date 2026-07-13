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
  <div class="localfile-config">
    <div class="form-group">
      <label class="form-label">启用</label>
      <Switch :modelValue="cfg.enabled" @update:modelValue="setEnabled" />
    </div>

    <div class="form-group">
      <label class="form-label">输出目录</label>
      <input class="form-input" v-model="cfg.outputPath" placeholder="默认：~/.lynel-desktop/output/" :disabled="disabled" />
    </div>

    <div class="form-group">
      <label class="form-label">输出格式</label>
      <select class="form-input" v-model="cfg.format" :disabled="disabled">
        <option value="jsonl">JSONL（每行一条记录）</option>
        <option value="json">JSON（美化输出）</option>
      </select>
    </div>

    <p class="placeholder-hint">本地文件通道即将上线，敬请期待。</p>
  </div>
</template>

<style scoped>
.localfile-config { padding: 0; }
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
select.form-input { cursor: pointer; }
.placeholder-hint { font-size: 12px; color: var(--text-tertiary); margin-top: 8px; padding: 10px; background: var(--bg-panel); border-radius: var(--radius-md); text-align: center; }
</style>
