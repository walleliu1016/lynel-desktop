<template>
  <div ref="triggerRef" class="project-switcher">
    <button class="action-btn" aria-label="切换项目" title="切换项目" @click="toggle">
      <Icon name="chevron-down" :size="13" />
    </button>
  </div>
  <Teleport to="body">
    <div v-if="open" class="switcher-overlay" @click.self="close">
      <div ref="panelRef" class="switcher-panel" :style="panelStyle">
        <button class="open-folder" @click="onOpenFolder">
          <Icon name="plus" :size="14" />
          <span>选择目录打开...</span>
        </button>
        <div class="divider" />
        <div class="section-title">最近会话</div>
        <div v-if="loading" class="loading">加载中...</div>
        <RecentSessionList
          v-else
          :list="recent"
          :limit="5"
          @select="onSelectRecent"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import Icon from './Icon.vue'
import RecentSessionList from './RecentSessionList.vue'
import type { RecentSession } from '../types/recent'

const props = defineProps<{ recent: RecentSession[]; loading?: boolean }>()
const emit = defineEmits<{
  (e: 'open-folder'): void
  (e: 'select-recent', item: RecentSession): void
}>()

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const position = ref({ top: 0, left: 0 })
const panelWidth = 280

const panelStyle = computed(() => ({
  top: `${position.value.top}px`,
  left: `${position.value.left}px`,
  width: `${panelWidth}px`,
}))

function updatePosition() {
  const r = triggerRef.value?.getBoundingClientRect()
  if (!r) return
  const top = r.bottom + 6
  let left = r.left - panelWidth + r.width
  if (left < 8) left = 8
  if (left + panelWidth > window.innerWidth - 8) {
    left = window.innerWidth - panelWidth - 8
  }
  position.value = { top, left }
}

function toggle() {
  open.value = !open.value
  if (open.value) {
    nextTick(() => {
      updatePosition()
    })
  }
}

function close() {
  open.value = false
}

function onOpenFolder() {
  close()
  emit('open-folder')
}

function onSelectRecent(item: RecentSession) {
  close()
  emit('select-recent', item)
}

watch(open, (isOpen) => {
  if (isOpen) {
    window.addEventListener('resize', updatePosition)
  } else {
    window.removeEventListener('resize', updatePosition)
  }
})

defineExpose({ close })
</script>

<style scoped>
.project-switcher { display: inline-flex; }
.action-btn {
  width: 26px; height: 26px; border-radius: var(--radius-md);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary); background: transparent;
}
.action-btn:hover { background: var(--bg-input); color: var(--text-primary); }
.switcher-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: transparent;
}
.switcher-panel {
  position: absolute;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  padding: 8px;
}
.open-folder {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: var(--radius-md);
  font-size: 12px; color: var(--text-primary);
  background: transparent;
}
.open-folder:hover { background: var(--accent-soft-bg); color: var(--accent); }
.divider {
  height: 1px; background: var(--border); margin: 8px 4px;
}
.section-title {
  padding: 2px 10px 6px;
  font-size: 10px; font-weight: 700; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 0.4px;
}
.loading {
  padding: 10px; font-size: 12px; color: var(--text-secondary);
  text-align: center;
}
</style>
