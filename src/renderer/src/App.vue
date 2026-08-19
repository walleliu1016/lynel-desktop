<template>
  <router-view />
  <ToastCenter />
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { EventsOn, WindowShow, WindowUnminimise, WindowCenter } from './composables/useElectron'
import { useWindowState } from './composables/useWindowState'
import { useTabsStore } from './stores/tabs'
import ToastCenter from './components/ToastCenter.vue'
import { useSettingsStore } from './stores/settings'

const router = useRouter()
const win = useWindowState()
const tabs = useTabsStore()
const settings = useSettingsStore()
let cleanup: (() => void) | null = null

onMounted(async () => {
  // 启动时先加载全局设置（agent 开关等），失败不阻塞布局
  try { await settings.load() } catch {}
  // 启动时先按登录页尺寸布局、居中并显示窗口，避免从默认尺寸闪现
  try { await win.applyLoginLayout() } catch {}
  try { WindowCenter() } catch {}
  try { win.show() } catch {}

  cleanup = EventsOn('tray:open-settings', () => {
    WindowShow()
    WindowUnminimise()
    router.push('/home').then(() => {
      tabs.openSettings()
    })
  })
})

onBeforeUnmount(() => {
  cleanup?.()
})
</script>

<style>
#app { height: 100%; }
</style>
