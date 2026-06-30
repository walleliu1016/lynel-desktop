<template>
  <div class="toast-container">
    <transition-group name="toast">
      <div
        v-for="item in visibleToasts"
        :key="item.id"
        class="toast"
        @click="onClick(item)"
      >
        <div class="toast-icon">{{ item.isAsk ? '?' : '⚠' }}</div>
        <div class="toast-content">
          <div class="toast-title">{{ item.title }}</div>          <div class="toast-desc">{{ item.desc }}</div>
          <div v-if="!item.isAsk" class="toast-actions">
            <button class="toast-btn deny" @click.stop="onDeny(item)">拒绝</button>
            <button class="toast-btn allow" @click.stop="onAllow(item)">允许</button>
          </div>
        </div>
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { HookPermissionRequest } from '../stores/sessions'

interface ToastItem {
  id: string
  sessionId: string
  requestId: string
  title: string
  desc: string
  isAsk: boolean
}

const props = defineProps<{
  requests: Record<string, HookPermissionRequest | null>
}>()
const emit = defineEmits<{
  (e: 'switch', sessionId: string): void
  (e: 'decision', requestId: string, decision: { behavior: string; message?: string }): void
}>()

const toasts = ref<ToastItem[]>([])
const dismissed = ref<Set<string>>(new Set())

const visibleToasts = computed(() => toasts.value.filter((t) => !dismissed.value.has(t.id)))

watch(
  () => props.requests,
  (next) => {
    for (const [sid, req] of Object.entries(next)) {
      if (!req) continue
      const id = `${sid}-${req.requestId}`
      if (toasts.value.some((t) => t.id === id)) continue
      const isAsk = req.toolName === 'AskUserQuestion'
      toasts.value.push({
        id,
        sessionId: sid,
        requestId: req.requestId,
        title: isAsk ? '需要你确认' : '工具执行请求',
        desc: `${req.toolName || '工具'} 请求授权`,
        isAsk,
      })
    }
    // 清理已消失的请求对应的 toast
    const activeIds = new Set(
      Object.entries(next)
        .filter(([, req]) => !!req)
        .map(([sid, req]) => `${sid}-${req!.requestId}`)
    )
    toasts.value = toasts.value.filter((t) => activeIds.has(t.id))
  },
  { deep: true }
)

function onClick(item: ToastItem) {
  emit('switch', item.sessionId)
}

function onAllow(item: ToastItem) {
  dismissed.value.add(item.id)
  emit('decision', item.requestId, { behavior: 'allow' })
}

function onDeny(item: ToastItem) {
  dismissed.value.add(item.id)
  emit('decision', item.requestId, { behavior: 'deny', message: 'user denied from toast' })
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.toast {
  width: 320px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-left: 4px solid #fbbf24;
  border-radius: 8px;
  padding: 12px 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  display: flex;
  gap: 12px;
  cursor: pointer;
  transition: transform 0.15s;
}
.toast:hover { transform: translateX(-4px); }
.toast-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.toast-content { flex: 1; min-width: 0; }
.toast-title { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 3px; }
.toast-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toast-actions { display: flex; gap: 6px; margin-top: 8px; }
.toast-btn {
  flex: 1;
  padding: 5px 0;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  border: none;
}
.toast-btn.deny { background: transparent; border: 1px solid var(--border); color: var(--text-primary); }
.toast-btn.allow { background: var(--accent); color: white; }

.toast-enter-active,
.toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from,
.toast-leave-to { opacity: 0; transform: translateX(20px); }
</style>
