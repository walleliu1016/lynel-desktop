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
// 不设背景色：claude/codex 单色 logo 直接用 fg 色（currentColor）渲染，
// opencode/omp 官方 logo 自带品牌底色，无需额外衬底。
const badgeStyle = computed(() => ({ color: `var(${meta.value.fgVar})` }))
</script>

<style scoped>
.agent-badge { display: inline-flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; user-select: none; }
.agent-badge.md { width: 34px; height: 34px; border-radius: 10px; }
.agent-badge.sm { width: 16px; height: 16px; border-radius: 4px; }
.agent-badge-svg { width: 100%; height: 100%; display: block; flex-shrink: 0; }
</style>
