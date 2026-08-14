<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import SpringTransition from './SpringTransition.vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  message: string
  warningTitle?: string
  confirmText?: string
  icon?: string
  danger?: boolean
}>(), {
  warningTitle: '',
  confirmText: '确认',
  icon: 'warning',
  danger: false,
})

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const confirmBtn = ref<HTMLButtonElement | null>(null)

function focusConfirm() {
  nextTick(() => {
    confirmBtn.value?.focus()
  })
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
  } else if (event.key === 'Enter') {
    event.preventDefault()
    emit('confirm')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

watch(() => props.open, (open) => {
  if (open) focusConfirm()
})
</script>

<template>
  <div class="overlay" :class="{ open }" @click.self="open && $emit('cancel')">
    <SpringTransition>
    <div v-if="open" class="dialog" role="dialog" aria-modal="true">
      <div class="head">
        <h2>{{ title }}</h2>
        <button class="close" aria-label="关闭" title="关闭" @click="$emit('cancel')">
          <Icon name="close" :size="14" />
        </button>
      </div>
      <div class="body">
        <div class="warn-row">
          <Icon :name="icon" :size="18" class="warn-icon" />
          <div class="warn-text">
            <p v-if="warningTitle" class="warn-title">{{ warningTitle }}</p>
            <p class="warn-desc">{{ message }}</p>
          </div>
        </div>
      </div>
      <div class="form-actions">
        <button class="cancel" @click="$emit('cancel')">取消</button>
        <button ref="confirmBtn" class="confirm" :class="{ danger }" @click="$emit('confirm')">{{ confirmText }}</button>
      </div>
    </div>
    </SpringTransition>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: var(--scrim);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  opacity: 0; pointer-events: none;
  transition: opacity 0.2s ease;
}
.overlay.open { opacity: 1; pointer-events: auto; }
.dialog {
  width: 440px;
  max-width: calc(100% - 40px);
  background: var(--material-bg, rgba(255,255,255,0.72));
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--border); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 20px 10px;
}
h2 { font-size: 14px; color: var(--text-primary); margin: 0; }
.close {
  color: var(--text-secondary); padding: 2px 6px; border-radius: var(--radius-sm);
  display: flex; align-items: center;
}
.close:hover { background: var(--bg-hover); color: var(--text-primary); }
.body { padding: 8px 20px 20px; }
.warn-row { display: flex; gap: 12px; align-items: flex-start; }
.warn-icon { color: var(--status-warn); flex-shrink: 0; margin-top: 1px; }
.warn-text { min-width: 0; }
.warn-title { font-size: 13px; color: var(--text-primary); font-weight: 600; margin: 0 0 4px; }
.warn-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.6; margin: 0; word-break: break-word; }
.form-actions {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 20px 18px;
}
.cancel {
  background: var(--bg-input); color: var(--text-primary);
  border: 1px solid var(--border-strong); border-radius: var(--radius-md);
  padding: 6px 14px; font-size: var(--fs-body-sm);
  transition: border-color 0.15s, color 0.15s;
}
.cancel:hover { border-color: var(--accent); color: var(--accent); }
.confirm {
  padding: 7px 18px; background: var(--accent); color: var(--text-inverse);
  border: none; border-radius: var(--radius-md); font-size: var(--fs-body-sm); font-weight: 500;
  transition: filter 0.15s, box-shadow 0.15s;
}
.confirm:hover:not(:disabled) { filter: brightness(1.06); }
.confirm:active:not(:disabled) { transform: scale(0.97); }
.confirm:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--accent-glow); }
.confirm.danger { background: var(--status-error); }
.confirm.danger:hover:not(:disabled) { filter: brightness(0.96); }
.confirm.danger:focus-visible { box-shadow: 0 0 0 2px var(--status-error-soft); }
</style>
