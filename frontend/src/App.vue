<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { EventsOn, WindowShow, WindowUnminimise, WindowCenter } from './composables/useElectron'
import { useWindowState } from './composables/useWindowState'

const router = useRouter()
const win = useWindowState()
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
</style>
