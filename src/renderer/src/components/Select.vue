<template>
  <div class="lynel-select" ref="rootEl">
    <button
      ref="triggerEl"
      type="button"
      class="ls-trigger"
      :class="{ open, 'is-sm': size === 'sm', disabled }"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="ls-value" :class="{ placeholder: !selectedLabel }">{{ selectedLabel || placeholder || '请选择' }}</span>
      <Icon name="chevron-down" :size="12" class="ls-chevron" :class="{ open }" />
    </button>
    <Teleport to="body">
      <div v-if="open" ref="panelEl" class="ls-panel" :class="{ 'is-sm': size === 'sm' }" :style="panelStyle">
        <button
          v-for="opt in options"
          :key="opt.value"
          type="button"
          class="ls-option"
          :class="{ selected: opt.value === modelValue, disabled: opt.disabled }"
          :disabled="opt.disabled"
          @click="pick(opt)"
        >
          <span class="ls-option-label">{{ opt.label }}</span>
          <Icon v-if="opt.value === modelValue" name="check" :size="13" class="ls-check" />
        </button>
        <div v-if="!options.length" class="ls-empty">无选项</div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue: string
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  size?: 'md' | 'sm'
}>(), {
  placeholder: '',
  disabled: false,
  size: 'md',
})

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
const rootEl = ref<HTMLDivElement | null>(null)
const triggerEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLDivElement | null>(null)
const panelStyle = ref<Record<string, string>>({})

const selectedLabel = computed(() => props.options.find((o) => o.value === props.modelValue)?.label ?? '')

function toggle() {
  if (open.value) close()
  else openPanel()
}

function openPanel() {
  open.value = true
  nextTick(() => {
    const el = triggerEl.value
    if (!el) return
    const r = el.getBoundingClientRect()
    panelStyle.value = {
      position: 'fixed',
      top: `${r.bottom + 4}px`,
      left: `${r.left}px`,
      minWidth: `${r.width}px`,
    }
  })
  document.addEventListener('mousedown', onDocMouseDown)
  document.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', close)
}

function close() {
  open.value = false
  document.removeEventListener('mousedown', onDocMouseDown)
  document.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('resize', close)
}

function onDocMouseDown(e: MouseEvent) {
  const t = e.target as Node
  if (rootEl.value?.contains(t)) return
  if (panelEl.value?.contains(t)) return
  close()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

function pick(opt: SelectOption) {
  if (opt.disabled) return
  emit('update:modelValue', opt.value)
  close()
}

onBeforeUnmount(close)
</script>

<style scoped>
.lynel-select { position: relative; display: flex; width: 100%; }
.ls-trigger {
  display: flex; align-items: center; gap: 6px;
  width: 100%; height: 34px; padding: 0 10px;
  border: 1px solid var(--border-strong); border-radius: var(--radius-md);
  background: var(--bg-input); color: var(--text-primary);
  font-size: 12px; font-family: inherit; cursor: pointer;
  transition: border-color 0.15s;
}
.ls-trigger:hover:not(:disabled) { border-color: var(--accent); }
.ls-trigger.open { border-color: var(--accent); }
.ls-trigger:disabled { opacity: 0.5; cursor: not-allowed; }
.ls-trigger.is-sm { height: 30px; padding: 0 8px; font-size: 12px; }
.ls-value { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ls-value.placeholder { color: var(--text-tertiary); }
.ls-chevron { color: var(--text-tertiary); flex-shrink: 0; transition: transform 0.15s; }
.ls-chevron.open { transform: rotate(180deg); }
.ls-panel {
  z-index: 1000; max-height: 280px; overflow-y: auto;
  background: var(--bg-panel); border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  padding: 4px;
}
.ls-panel.is-sm { max-height: 240px; }
.ls-option {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; padding: 7px 10px;
  border: none; background: transparent; border-radius: var(--radius-md);
  color: var(--text-primary); font-size: 12px; font-family: inherit; cursor: pointer;
  text-align: left;
}
.ls-option:hover:not(:disabled) { background: var(--accent-soft-bg); }
.ls-option.selected { color: var(--accent); font-weight: 600; }
.ls-option.disabled { color: var(--text-tertiary); cursor: not-allowed; }
.ls-option-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ls-check { flex-shrink: 0; }
.ls-empty { padding: 10px; text-align: center; font-size: 12px; color: var(--text-tertiary); }
</style>
