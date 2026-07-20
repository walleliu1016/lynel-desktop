<template>
  <div class="tools-pane">
    <div v-for="(t, i) in tools" :key="i" class="block">
      <div class="h">{{ t.name }}</div>
      <pre>{{ t.description }}\n\n— schema —\n{{ t.schema }}</pre>
    </div>
    <div v-if="!tools.length" class="empty">无 tools</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ detail: any }>()
const tools = computed(() => {
  const list = props.detail?.request?.body?.tools || []
  return list.map((t: any) => ({
    name: t.name,
    description: t.description || '',
    schema: JSON.stringify(t.input_schema || {}, null, 2),
  }))
})
</script>

<style scoped>
.tools-pane { padding: 12px; overflow: auto; }
.block { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 4px; }
.h { padding: 4px 8px; background: var(--bg-card, rgba(0,0,0,0.03)); font-size: 12px; font-weight: 600; }
pre { padding: 8px; margin: 0; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.empty { padding: 20px; text-align: center; color: var(--text-tertiary); }
</style>
