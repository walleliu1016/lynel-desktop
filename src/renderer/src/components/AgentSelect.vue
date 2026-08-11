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
import Select from './Select.vue'
import { AGENT_KINDS, agentMeta, type AgentKind } from '../types/agents'

const props = defineProps<{ modelValue: AgentKind }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: AgentKind): void }>()

const options = computed(() =>
  AGENT_KINDS.map((k) => ({
    value: k,
    label: `${agentMeta(k).abbr} ${agentMeta(k).short}`,
  })),
)

function onChange(v: string) {
  emit('update:modelValue', v as AgentKind)
}
</script>
