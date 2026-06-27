<template>
  <div class="composer">
    <textarea
      v-model="text"
      class="input"
      :placeholder="placeholder"
      :disabled="disabled"
      @keydown.enter.exact.prevent="onSend"
    />
    <button class="send" :disabled="!text.trim() || disabled" @click="onSend">发送</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const props = defineProps<{ disabled?: boolean; placeholder?: string }>()
const emit = defineEmits<{ (e: 'send', text: string): void }>()

const text = ref('')
const placeholder = props.placeholder ?? '输入消息…'
function onSend() {
  const t = text.value.trim()
  if (!t || props.disabled) return
  emit('send', t)
  text.value = ''
}
</script>

<style scoped>
.composer {
  display: flex; gap: 8px; padding: 10px 12px;
  background: var(--bg-panel); border-top: 1px solid var(--border);
}
.input {
  flex: 1; resize: none; min-height: 36px; max-height: 120px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 8px 10px;
  color: var(--text-primary); font-size: 12px;
  font-family: inherit;
}
.input:focus { outline: none; border-color: var(--accent); }
.send {
  background: var(--accent); color: white;
  padding: 0 16px; border-radius: var(--radius-md);
  font-size: 12px; font-weight: 500;
  align-self: flex-end; height: 36px;
}
.send:hover:not(:disabled) { background: var(--accent-light); }
.send:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
