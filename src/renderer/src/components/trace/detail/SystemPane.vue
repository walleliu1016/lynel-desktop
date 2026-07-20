<template>
  <div class="system-pane">
    <div v-for="(s, i) in system" :key="i" class="block">
      <div class="h">
        <span>{{ s.label }}</span>
        <span v-if="s.cache" class="tag cache">cache 1h</span>
      </div>
      <pre>{{ s.text }}</pre>
    </div>
    <div v-if="!system.length" class="empty">无 system</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ detail: any }>()
const system = computed(() => {
  const list = props.detail?.request?.body?.system || []
  return list.map((s: any, i: number) => ({
    label: `system[${i}]`,
    text: s.text || '',
    cache: !!s.cache_control,
  }))
})
</script>

<style scoped>
.system-pane { padding: 12px; overflow: auto; }
.block { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 4px; }
.h { padding: 4px 8px; background: var(--bg-card, rgba(0,0,0,0.03)); display: flex; justify-content: space-between; font-size: 11px; }
.tag.cache { background: #fb8c00; color: #fff; padding: 0 6px; border-radius: 2px; font-size: 10px; }
pre { padding: 8px; margin: 0; font-size: 12px; white-space: pre-wrap; }
.empty { padding: 20px; text-align: center; color: var(--text-tertiary); }
</style>
