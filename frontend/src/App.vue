<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { EventsOn, WindowShow, WindowUnminimise } from './composables/useWails'

const router = useRouter()
let cleanup: (() => void) | null = null

onMounted(() => {
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
