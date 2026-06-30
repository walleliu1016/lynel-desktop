<template>
  <div class="composer">
    <textarea
      ref="inputEl"
      v-model="text"
      class="input"
      :class="{ 'terminal-mode': terminalMode }"
      :rows="1"
      :placeholder="resolvedPlaceholder"
      :disabled="disabled"
      @input="autoResize"
      @keydown.enter.exact.prevent="onSend"
    />
    <button
      class="send"
      :class="{ 'terminal-mode': terminalMode }"
      :disabled="!text.trim() || disabled"
      @click="onSend"
    >
      {{ terminalMode ? '切回并发送' : '发送' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, computed, watch } from 'vue'
import { useSessionsStore } from '../stores/sessions'

const props = defineProps<{
  disabled?: boolean
  placeholder?: string
  terminalMode?: boolean
  state?: 'idle' | 'waiting' | 'thinking' | 'streaming' | 'running_tool' | 'awaiting_permission' | 'done' | 'ended'
}>()
const emit = defineEmits<{ (e: 'send', text: string): void }>()

const sessions = useSessionsStore()
const inputEl = ref<HTMLTextAreaElement | null>(null)

// 每个 session 独立的输入草稿
const text = ref('')

// 切换 session 时：保存旧草稿 → 恢复新草稿
watch(() => sessions.activeId, (newId, oldId) => {
  if (oldId) sessions.setDraft(oldId, text.value)
  text.value = newId ? (sessions.drafts[newId] || '') : ''
  nextTick(() => autoResize())
})

// 输入变化 → 实时保存草稿
watch(text, (v) => {
  if (sessions.activeId) sessions.setDraft(sessions.activeId, v)
})

const resolvedPlaceholder = computed(() => {
  if (props.placeholder) return props.placeholder
  if (props.terminalMode) return '外部终端中 · 输入会切回 App 控制'
  switch (props.state) {
    case 'waiting': return 'Claude 正在准备响应…'
    case 'thinking': return 'Claude 思考中…'
    case 'streaming': return 'Claude 生成中…'
    case 'running_tool': return '工具执行中，请稍候…'
    case 'awaiting_permission': return '请先在上方处理权限请求'
    default: return '输入消息…'
  }
})

function autoResize() {
  nextTick(() => {
    const el = inputEl.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  })
}

function onSend() {
  const t = text.value.trim()
  if (!t || props.disabled) return
  emit('send', t)
  text.value = ''
  nextTick(() => autoResize())
}
</script>

<style scoped>
.composer {
  display: flex; align-items: center; gap: 8px; padding: 0 12px;
  background: var(--bg-panel); border-top: 1px solid var(--border);
  box-shadow: var(--composer-shadow);
  flex-shrink: 0; height: 46px;
  z-index: 1;
}
.input {
  flex: 1; resize: none; overflow: hidden;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 5px 10px;
  color: var(--text-primary); font-size: 14px;
  font-family: inherit; line-height: 1.5;
  min-height: 32px; max-height: 120px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.input:focus { outline: none; border-color: var(--accent); }
/* 外部终端中：边框 + placeholder 染成 warn 色，提示用户输入会切回 App */
.input.terminal-mode {
  border-color: var(--status-warn);
  box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.2);
}
.input.terminal-mode::placeholder { color: var(--status-warn); }
.send {
  background: var(--accent); color: white;
  padding: 5px 14px; border-radius: var(--radius-md);
  font-size: 12px; font-weight: 500;
  flex-shrink: 0; height: 30px;
  transition: background 0.15s;
}
.send:hover:not(:disabled) { background: var(--accent-deep); }
.send:disabled { opacity: 0.4; cursor: not-allowed; }
/* 切回按钮：warn 色 + 黑字，跟普通发送按钮视觉区分 */
.send.terminal-mode { background: var(--status-warn); color: #000; }
.send.terminal-mode:hover:not(:disabled) { background: #F59E0B; }
</style>
