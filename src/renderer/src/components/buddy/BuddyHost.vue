<template>
  <BuddyPet
    v-if="settings.cfg?.buddyEnabled"
    :role="effectiveRole"
    :stats="stats"
    :state="props.state"
    class-name="buddy-host"
  />
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { SessionState } from '../../types/session'
import BuddyPet from './BuddyPet.vue'
import { useBuddyStats } from '../../composables/useBuddyStats'
import { useSettingsStore } from '../../stores/settings'
import { applyCustomAscii } from '../../data/buddies/validate'

const props = withDefaults(defineProps<{
  sessionId?: string | null
  state?: SessionState | null
}>(), {
  sessionId: null,
  state: null,
})

const settings = useSettingsStore()
const { role, stats, startDecay } = useBuddyStats(() => props.sessionId)

/** 自定义 ASCII 覆盖角色画（校验 + 首尾空行剔除见 applyCustomAscii） */
const effectiveRole = computed(() => applyCustomAscii(role.value, settings.cfg?.buddyCustomAscii || ''))

onMounted(() => {
  startDecay()
})
</script>

<style scoped>
/* 对所有挂载点通用定位：右下角。某处需要不同位置时用挂载点自己的 scoped class 覆盖。 */
.buddy-host { position: absolute; right: 16px; bottom: 12px; opacity: 0.85; }
.buddy-host:hover { opacity: 1; }
</style>
