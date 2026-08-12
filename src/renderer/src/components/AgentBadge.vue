<template>
  <span class="agent-badge" :class="size" :style="badgeStyle" :title="meta.label">
    <svg class="agent-badge-svg" :viewBox="logo.viewBox" v-html="logo.inner" />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { agentMeta } from '../types/agents'
import { AGENT_LOGOS } from '../agentLogos'

const props = withDefaults(defineProps<{ agent?: string | null; size?: 'sm' | 'md' }>(), { size: 'md' })
const meta = computed(() => agentMeta(props.agent))
const logo = computed(() => AGENT_LOGOS[meta.value.kind])
const badgeStyle = computed(() => ({ background: `var(${meta.value.bgVar})`, color: `var(${meta.value.fgVar})` }))
</script>

<style scoped>
.agent-badge { display: inline-flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; user-select: none; }
.agent-badge.md { width: 34px; height: 34px; border-radius: 10px; }
.agent-badge.sm { width: 20px; height: 20px; border-radius: 6px; }
.agent-badge-svg { width: 100%; height: 100%; display: block; flex-shrink: 0; }
</style>
