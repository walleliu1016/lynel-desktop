<template>
  <div v-if="visible" class="perm-toast" @click="handleClick">
    <Icon name="warning" :size="16" />
    <span class="perm-text">Claude 请求权限：{{ toolName }}</span>
    <span class="perm-hint">点击查看详情</span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps<{
  toolName: string
  sessionId: string
}>()

const emit = defineEmits<{
  (e: 'navigate', sessionId: string): void
}>()

const visible = ref(false)

watch(() => props.toolName, (name) => {
  if (name) {
    visible.value = true
    setTimeout(() => { visible.value = false }, 8000)
  }
}, { immediate: true })

function handleClick() {
  visible.value = false
  emit('navigate', props.sessionId)
}
</script>

<style scoped>
.perm-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: var(--status-warn);
  color: #000;
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 1000;
  animation: slideUp 0.3s ease;
}
@keyframes slideUp { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
.perm-hint { opacity: 0.7; font-size: 11px }
</style>
