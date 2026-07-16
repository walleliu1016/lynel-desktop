<script setup lang="ts">
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'change'): void
}>()

function toggle() {
  emit('update:modelValue', !props.modelValue)
  emit('change')
}
</script>

<template>
  <span class="switch-control" @click.stop="toggle">
    <input type="checkbox" :checked="modelValue" @change="toggle" />
    <span class="slider" />
  </span>
</template>

<style scoped>
.switch-control {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 22px;
  flex-shrink: 0;
}
.switch-control input {
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--switch-track, var(--border));
  border-radius: 11px;
  transition: 0.2s;
}
.slider::before {
  position: absolute;
  content: '';
  height: 16px;
  width: 16px;
  left: 3px;
  top: 3px;
  background: var(--switch-knob, #FFFFFF);
  border-radius: 50%;
  transition: 0.2s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}
.switch-control input:checked + .slider {
  background: var(--accent);
}
.switch-control input:checked + .slider::before {
  transform: translateX(16px);
}
</style>
