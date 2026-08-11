<template>
  <div class="surface" :class="[`lv${level}`, { material, rounded }]">
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ level?: 1 | 2 | 3; material?: boolean; rounded?: boolean }>(), {
  level: 1, material: false, rounded: true,
})
</script>

<style scoped>
.surface { background: var(--bg-panel); border: 1px solid var(--border); }
.surface.lv2 { background: var(--bg-input); box-shadow: var(--shadow-panel); }
.surface.lv3 { box-shadow: var(--shadow-window); }
.surface.rounded { border-radius: var(--radius-lg); }
/* .material 由 base.css 的全局类补充 backdrop-filter，不在 scoped 内重复定义 */
</style>
