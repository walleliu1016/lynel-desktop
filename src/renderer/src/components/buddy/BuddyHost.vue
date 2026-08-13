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
import { validateCustomAscii } from '../../data/buddies/validate'
import type { BuddyRole } from '../../data/buddies/types'

const props = withDefaults(defineProps<{
  sessionId?: string | null
  state?: SessionState | null
}>(), {
  sessionId: null,
  state: null,
})

const settings = useSettingsStore()
const { role, stats, startDecay } = useBuddyStats(() => props.sessionId)

/**
 * 自定义 ASCII 覆盖角色画：粘贴内容合法时，把 idle/thinking/celebration/alarm
 * 四组帧都替换为自定义图案（单帧，退化为通用浮动）。
 * 首尾空行剔除：粘贴时首/尾换行会在 lines 里留下空行，渲染会多出空行；
 * 这里只剔除头部/尾部的空行，保留中部空行以维持构图。
 */
const effectiveRole = computed<BuddyRole>(() => {
  const base = role.value
  const ascii = settings.cfg?.buddyCustomAscii || ''
  const r = validateCustomAscii(ascii)
  if (!r.ok) return base
  const lines = r.lines.slice()
  while (lines.length && lines[0].trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  if (!lines.length) return base
  return {
    ...base,
    frames: {
      ...base.frames,
      idle: lines,
      thinking: lines,
      celebration: lines,
      alarm: lines,
    },
  }
})

onMounted(() => {
  startDecay()
})
</script>

<style scoped>
/* 对所有挂载点通用定位：右下角。某处需要不同位置时用挂载点自己的 scoped class 覆盖。 */
.buddy-host { position: absolute; right: 16px; bottom: 12px; opacity: 0.85; }
.buddy-host:hover { opacity: 1; }
</style>
