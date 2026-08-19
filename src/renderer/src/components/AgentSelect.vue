<template>
  <Select
    :model-value="modelValue"
    :options="options"
    placeholder="选择 Agent"
    @update:model-value="onChange"
  />
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import Select, { type SelectOption } from './Select.vue'
import { agentMeta, type AgentKind } from '../types/agents'
import { AGENT_LOGOS } from '../agentLogos'
import { useSettingsStore } from '../stores/settings'

const props = defineProps<{ modelValue: AgentKind }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: AgentKind): void }>()
const settings = useSettingsStore()

const options = computed<SelectOption[]>(() =>
  settings.enabledAgentKinds.map((k) => {
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

// 当前选中 agent 被开关禁用时，回退 claude（保证下拉里永远有选中项）。
// Pinia 会把 setup store 返回的 computed 解包成数组，需用 getter 形式监视。
watch(() => settings.enabledAgentKinds, (kinds) => {
  if (!kinds.includes(props.modelValue)) emit('update:modelValue', 'claude')
})

function onChange(v: string) {
  emit('update:modelValue', v as AgentKind)
}
</script>
