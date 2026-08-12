<template>
  <Select
    :model-value="modelValue"
    :options="options"
    placeholder="选择 Agent"
    @update:model-value="onChange"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Select, { type SelectOption } from './Select.vue'
import { AGENT_KINDS, agentMeta, type AgentKind } from '../types/agents'
import { AGENT_LOGOS } from '../agentLogos'

const props = defineProps<{ modelValue: AgentKind }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: AgentKind): void }>()

const options = computed<SelectOption[]>(() =>
  AGENT_KINDS.map((k) => {
    const m = agentMeta(k)
    const logo = AGENT_LOGOS[k]
    return {
      value: k,
      label: m.label,
      // 与 AgentBadge 一致：不设背景色块，claude/codex 单色 logo 用 fg 色渲染，
      // opencode/omp 官方 logo 自带品牌底色。
      icon: {
        bg: 'transparent',
        fg: `var(${m.fgVar})`,
        svg: logo.inner,
        viewBox: logo.viewBox,
      },
    }
  }),
)

function onChange(v: string) {
  emit('update:modelValue', v as AgentKind)
}
</script>
