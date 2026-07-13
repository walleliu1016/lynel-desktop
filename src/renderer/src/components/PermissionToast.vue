<template>
  <div v-if="visible" class="perm-toast">
    <Icon name="warning" :size="16" />
    <span class="perm-text">Claude 请求权限：{{ toolName }}</span>
    <div class="perm-actions">
      <button class="perm-deny" @click.stop="onDeny">拒绝</button>
      <button class="perm-allow" @click.stop="onAllow">允许</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Icon from './Icon.vue'
import { ResolvePermission } from '../composables/useElectron'

const props = defineProps<{
  toolName: string
  sessionId: string
  requestId: string
}>()

const emit = defineEmits<{
  (e: 'navigate', sessionId: string): void
}>()

const visible = ref(false)

watch(() => props.toolName, (name) => {
  if (name) {
    visible.value = true
  }
}, { immediate: true })

function onAllow() {
  if (props.requestId) {
    try { ResolvePermission(props.requestId, 'allow', 'main-window') } catch {}
  }
  visible.value = false
}

function onDeny() {
  if (props.requestId) {
    try { ResolvePermission(props.requestId, 'deny', 'main-window') } catch {}
  }
  visible.value = false
}
</script>

<style scoped>
.perm-toast {
  position: fixed;
  bottom: 20px; right: 20px;
  background: var(--status-warn);
  color: #000;
  padding: 10px 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 1000;
  animation: slideUp 0.3s ease;
}
@keyframes slideUp { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
.perm-text { flex: 1; min-width: 0; }
.perm-actions { display: flex; gap: 6px; flex-shrink: 0; }
.perm-actions button {
  padding: 4px 12px; border: none; border-radius: 4px;
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.perm-deny { background: rgba(0,0,0,0.15); color: #333; }
.perm-deny:hover { background: rgba(0,0,0,0.25); }
.perm-allow { background: #22C55E; color: #fff; }
.perm-allow:hover { background: #16a34a; }
</style>
