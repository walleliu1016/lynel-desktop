<template>
  <div class="titlebar" data-tauri-drag-region>
    <div class="titlebar-left">
      <div class="brand-logo">E</div>
      <span class="brand-name">Ease</span>
    </div>
    <div class="titlebar-right">
      <button class="win-btn" @click="$emit('minimize')" title="最小化">─</button>
      <button class="win-btn" @click="$emit('maximize')" title="最大化">▢</button>
      <button class="win-btn close" @click="$emit('close')" title="关闭">✕</button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  (e: 'minimize'): void
  (e: 'maximize'): void
  (e: 'close'): void
}>()
</script>

<style scoped>
.titlebar {
  height: 32px;
  background: var(--bg-titlebar);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  user-select: none;
}
.titlebar-left, .titlebar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
}
.brand-logo {
  width: 15px; height: 15px; border-radius: 3px;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  display: flex; align-items: center; justify-content: center;
  color: white; font-size: 8px; font-weight: 700;
}
.brand-name { font-weight: 600; font-size: 12px; }
.win-btn {
  width: 18px; height: 14px; border-radius: 2px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary); font-size: 9px;
  background: transparent;
  border: none;
  cursor: pointer;
}
.win-btn:hover { background: rgba(255,255,255,0.06); }
.win-btn.close:hover { background: var(--status-error); color: white; }
</style>
