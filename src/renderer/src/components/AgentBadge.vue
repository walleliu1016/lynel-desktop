<template>
  <span class="agent-badge" :class="size" :style="badgeStyle" :title="meta.label">{{ meta.abbr }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { agentMeta } from '../types/agents'

const props = withDefaults(defineProps<{ agent?: string | null; size?: 'sm' | 'md' }>(), { size: 'md' })
const meta = computed(() => agentMeta(props.agent))
const badgeStyle = computed(() => ({ background: `var(${meta.value.bgVar})`, color: `var(${meta.value.fgVar})` }))
</script>

<style scoped>
.agent-badge { display: inline-flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; user-select: none; }
.agent-badge.md { width: 34px; height: 34px; border-radius: 10px; font-size: 11px; }
.agent-badge.sm { width: 20px; height: 20px; border-radius: 6px; font-size: 9px; }
</style>
