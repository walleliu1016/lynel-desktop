<script setup lang="ts">
import { useToastState, pauseToast, resumeToast, type ToastItem } from '../composables/useToast'
import Icon from './Icon.vue'

const { items, dismiss } = useToastState()

function iconFor(level: ToastItem['level']): string {
  if (level === 'warn') return 'warning'
  if (level === 'info') return 'sparkles'
  return 'alert-circle'
}

function onClick(item: ToastItem) {
  if (item.onClick) {
    item.onClick()
    dismiss(item.id)
  }
}

function onEnter(item: ToastItem) {
  pauseToast(item.id)
}
function onLeave(item: ToastItem) {
  resumeToast(item.id)
}
</script>

<template>
  <div class="toast-center" role="region" aria-label="外部交互通知">
    <TransitionGroup name="toast">
      <div
        v-for="item in items"
        :key="item.id"
        class="toast-item"
        :class="[`level-${item.level}`, { clickable: !!item.onClick }]"
        role="status"
        @mouseenter="onEnter(item)"
        @mouseleave="onLeave(item)"
        @click="onClick(item)"
      >
        <div class="toast-icon">
          <Icon :name="iconFor(item.level)" :size="16" />
        </div>
        <div class="toast-body">
          <div class="toast-source">{{ item.source }}</div>
          <div class="toast-message" :title="item.message">{{ item.message }}</div>
        </div>
        <button
          class="toast-close"
          aria-label="关闭通知"
          title="关闭"
          @click.stop="dismiss(item.id)"
        >
          <Icon name="close" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style>
.toast-center {
  position: fixed;
  right: 16px;
  top: 56px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 9999;
  pointer-events: none;
  max-width: calc(100vw - 32px);
}
.toast-item {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 360px;
  max-width: calc(100vw - 32px);
  padding: 10px 12px;
  background: var(--bg-panel);
  color: var(--text-primary, #1f2937);
  border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
  border-left-width: 3px;
  border-radius: var(--radius-md);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  font-size: 13px;
  line-height: 1.4;
}
.toast-item.level-error {
  border-left-color: var(--status-error);
}
.toast-item.level-warn {
  border-left-color: var(--status-warn);
}
.toast-item.level-info {
  border-left-color: var(--accent);
}
.toast-icon {
  flex: 0 0 16px;
  margin-top: 2px;
  color: var(--text-secondary, #6b7280);
}
.toast-item.level-error .toast-icon { color: var(--status-error); }
.toast-item.level-warn  .toast-icon { color: var(--status-warn); }
.toast-item.level-info  .toast-icon { color: var(--accent); }
.toast-item.clickable { cursor: pointer; }
.toast-body {
  flex: 1 1 auto;
  min-width: 0;
}
.toast-source {
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 2px;
}
.toast-message {
  word-break: break-word;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.toast-close {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-secondary, #6b7280);
  cursor: pointer;
  padding: 0;
  margin-top: 1px;
}
.toast-close:hover {
  background: var(--bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--text-primary, #1f2937);
}

/* TransitionGroup 动画：新条目从上插入，旧的下移 */
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
.toast-move {
  transition: transform 0.18s ease;
}
</style>
