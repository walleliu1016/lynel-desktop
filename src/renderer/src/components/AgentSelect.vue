<template>
  <div class="agent-picker" role="radiogroup" aria-label="选择 Agent">
    <button
      v-for="k in AGENT_KINDS"
      :key="k"
      type="button"
      class="agent-opt"
      :class="{ active: k === modelValue }"
      :style="optStyle(k)"
      :title="agentMeta(k).label"
      @click="onChange(k)"
    >
      {{ agentMeta(k).abbr }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { AGENT_KINDS, agentMeta, type AgentKind } from '../types/agents'

const props = defineProps<{ modelValue: AgentKind }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: AgentKind): void }>()

function optStyle(k: AgentKind) {
  const m = agentMeta(k)
  return {
    color: `var(${m.fgVar})`,
    background:
      k === props.modelValue
        ? `color-mix(in srgb, var(${m.bgVar}) 45%, transparent)`
        : 'transparent',
  }
}

function onChange(v: AgentKind) {
  emit('update:modelValue', v)
}
</script>

<style scoped>
.agent-picker {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.agent-opt {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
  opacity: 0.55;
  transition: background 0.12s, opacity 0.12s;
}
.agent-opt:hover {
  opacity: 1;
  background: var(--bg-hover);
}
.agent-opt.active {
  opacity: 1;
}
</style>
