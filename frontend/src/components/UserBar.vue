<template>
  <div class="userbar">
    <div class="user">
      <div class="avatar">👤</div>
      <div class="info">
        <div class="name">{{ username }}</div>
        <div class="version">v{{ version }}</div>
      </div>
    </div>
    <button class="settings" @click="$emit('settings')" title="设置">⚙</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ username: string; version: string }>()
defineEmits<{ (e: 'settings'): void }>()
</script>

<style scoped>
.userbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-top: 1px solid var(--border);
}
.user { display: flex; align-items: center; gap: 8px; min-width: 0; }
.avatar { font-size: 18px; }
.info { display: flex; flex-direction: column; }
.name { font-size: 12px; color: var(--text-primary); font-weight: 500; }
.version { font-size: 9px; color: var(--text-tertiary); }
.settings {
  width: 26px; height: 26px; border-radius: var(--radius-md);
  color: var(--text-secondary); font-size: 14px;
}
.settings:hover { background: var(--bg-input); color: var(--text-primary); }
</style>
