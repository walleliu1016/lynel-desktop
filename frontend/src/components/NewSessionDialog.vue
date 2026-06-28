<template>
  <div v-if="open" class="overlay" @click.self="$emit('close')">
    <div class="dialog">
      <div class="head">
        <h2>新建会话</h2>
        <button class="close" @click="$emit('close')">✕</button>
      </div>
      <form @submit.prevent="onSubmit" class="form">
        <div class="form-group">
          <label class="form-label">工作目录</label>
          <input class="form-input" v-model="workdir" placeholder="输入工作目录路径" />
        </div>
        <div class="form-group">
          <label class="form-label">提示词</label>
          <textarea class="form-input area" v-model="prompt" rows="5" placeholder="你想让 Claude 做什么？"></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="cancel" @click="$emit('close')">取消</button>
          <button type="submit" class="primary" :disabled="!workdir.trim() || !prompt.trim()">创建</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create', workdir: string, prompt: string): void
}>()

const workdir = ref('')
const prompt = ref('')

function onSubmit() {
  if (!workdir.value.trim() || !prompt.value.trim()) return
  emit('create', workdir.value.trim(), prompt.value.trim())
  workdir.value = ''
  prompt.value = ''
  emit('close')
}
</script>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.dialog {
  width: 460px; background: var(--bg-panel);
  border: 1px solid var(--border); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  padding: 16px 20px;
}
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
h2 { font-size: 14px; color: var(--text-primary); }
.close { color: var(--text-secondary); font-size: 12px; padding: 4px 8px; }
.close:hover { color: var(--text-primary); }
.form-group { margin-bottom: 10px; }
.form-label { display: block; font-size: 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
.form-input {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 8px 10px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
}
.form-input:focus { outline: none; border-color: var(--accent); }
.area { resize: vertical; min-height: 80px; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.cancel { padding: 6px 14px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-md); }
.cancel:hover { background: var(--border); }
.primary { padding: 6px 14px; background: var(--accent); color: white; border-radius: var(--radius-md); }
.primary:hover:not(:disabled) { background: var(--accent-light); }
.primary:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
