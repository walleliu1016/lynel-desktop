<template>
  <Teleport to=".center">
    <div ref="overlayRef" class="trace-overlay" :class="{ expanded }" tabindex="-1" @click.self="$emit('close')" @keydown.escape="onEscape">
      <!-- 背景遮罩 -->
      <div class="backdrop" @click="$emit('close')" />
      <!-- 右侧面板 -->
      <div class="panel">
        <div class="panel-header">
          <button class="panel-expand" @click="expanded = !expanded" :title="expanded ? '收起' : '展开'">
            <Icon :name="expanded ? 'shrink' : 'expand' " :size="14" />
          </button>
          <span class="panel-title" v-if="trace.detail">
            #{{ trace.detail.seq }} · {{ trace.detail.model || '—' }}
          </span>
          <span class="panel-title" v-else>Trace 详情</span>
          <button class="panel-close" @click="$emit('close')" title="关闭 (Esc)">
            <Icon name="close" :size="14" />
          </button>
        </div>
        <div class="panel-body">
          <RequestDetailPane
            :detail="trace.detail"
            :diff-result="trace.diffResult"
            :loading="trace.loading"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useTraceStore } from '../../stores/trace'
import RequestDetailPane from './RequestDetailPane.vue'
import Icon from '../Icon.vue'

const emit = defineEmits<{ (e: 'close'): void }>()

const trace = useTraceStore()
const overlayRef = ref<HTMLElement>()
const expanded = ref(false)
onMounted(() => overlayRef.value?.focus())

function onEscape() {
  if (expanded.value) {
    expanded.value = false
  } else {
    emit('close')
  }
}
</script>

<style scoped>
.trace-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  justify-content: flex-end;
}
.backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  animation: fadeIn 150ms ease;
}
.panel {
  position: relative;
  z-index: 1;
  width: 50%;
  max-width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-strong);
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.12);
  animation: slideIn 200ms ease;
  transition: width 250ms ease;
}
.expanded .panel {
  width: 100%;
}
.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.panel-title {
  flex: 1;
}
.panel-expand {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 100ms, color 100ms;
}
.panel-expand:hover { background: var(--bg-hover); color: var(--text-primary); }
.panel-close {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 100ms, color 100ms;
}
.panel-close:hover { background: var(--status-error-soft); color: var(--status-error); }
.panel-body { flex: 1; min-height: 0; overflow-y: auto; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

@media (prefers-reduced-motion: reduce) {
  .backdrop { animation: none; opacity: 0.25; }
  .panel { animation: none; }
}
</style>
