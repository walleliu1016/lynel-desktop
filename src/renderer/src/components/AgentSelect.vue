<template>
  <select class="agent-select" :value="modelValue" @change="onChange">
    <option v-for="k in AGENT_KINDS" :key="k" :value="k">{{ meta(k).abbr }} {{ meta(k).short }}</option>
  </select>
</template>

<script setup lang="ts">
import { AGENT_KINDS, agentMeta, type AgentKind } from '../types/agents'

const meta = agentMeta

defineProps<{ modelValue: AgentKind }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: AgentKind): void }>()

function onChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLSelectElement).value as AgentKind)
}
</script>

<style scoped>
.agent-select {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 8px 10px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
}
.agent-select:focus { outline: none; border-color: var(--accent); }
</style>
