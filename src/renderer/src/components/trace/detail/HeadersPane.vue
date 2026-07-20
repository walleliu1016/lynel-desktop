<template>
  <div class="headers-pane">
    <div class="block">
      <div class="h">request headers</div>
      <pre>{{ JSON.stringify(detail?.request?.headers || {}, null, 2) }}</pre>
    </div>
    <div class="block">
      <div class="h">response headers</div>
      <pre>{{ JSON.stringify(detail?.response?.headers || {}, null, 2) }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ detail: any }>()
</script>

<style scoped>
.headers-pane { padding: 12px; overflow: auto; }
.block { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 4px; }
.h { padding: 4px 8px; background: var(--bg-card, rgba(0,0,0,0.03)); font-size: 12px; }
pre { padding: 8px; margin: 0; font-size: 11px; white-space: pre-wrap; word-break: break-all; }
</style>
