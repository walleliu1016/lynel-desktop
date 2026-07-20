<template>
  <div :class="['card', error ? 'err' : '']">
    <div class="k">{{ label }}</div>
    <div class="v">
      {{ value }}
      <small v-if="sub">{{ sub }}</small>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  value: string
  sub?: string
  error?: boolean
}>()
</script>

<style scoped>
.card {
  background: var(--bg-card, rgba(0,0,0,0.03));
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
}
.card.err { border-color: var(--text-error, #c00); color: var(--text-error, #c00); }
.k { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; }
.v { font-size: 14px; font-weight: 600; margin-top: 2px; word-break: break-all; }
.v small { font-size: 10px; font-weight: normal; color: var(--text-secondary); margin-left: 4px; }
</style>
