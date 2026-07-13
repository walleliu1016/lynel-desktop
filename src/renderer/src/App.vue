<template>
  <router-view />
  <transition name="toast">
    <div v-if="toast.visible.value" class="global-toast" :class="toast.type.value">
      {{ toast.message.value }}
    </div>
  </transition>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { EventsOn, WindowShow, WindowUnminimise, WindowCenter } from './composables/useElectron'
import { useWindowState } from './composables/useWindowState'
import { useToastState } from './composables/useToast'

const router = useRouter()
const win = useWindowState()
const toast = useToastState()
let cleanup: (() => void) | null = null

onMounted(async () => {
  // 启动时先按登录页尺寸布局、居中并显示窗口，避免从默认尺寸闪现
  try { await win.applyLoginLayout() } catch {}
  try { WindowCenter() } catch {}
  try { win.show() } catch {}

  cleanup = EventsOn('tray:open-settings', () => {
    WindowShow()
    WindowUnminimise()
    router.push('/settings')
  })
})

onBeforeUnmount(() => {
  cleanup?.()
})
</script>

<style>
#app { height: 100%; }
.global-toast {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  color: white;
  background: var(--status-success);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  z-index: 9999;
  pointer-events: none;
}
.global-toast.error {
  background: var(--status-error);
}
.toast-enter-active, .toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.toast-enter-from, .toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
</style>
