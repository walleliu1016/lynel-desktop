<script setup lang="ts">
import Icon from '../Icon.vue'
import { useFilesStore } from '../../stores/files'

const store = useFilesStore()

function basename(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1)
}

function activate(relPath: string) {
  store.activeRelPath = relPath
}

function onReload(relPath: string) {
  void store.reloadFile(relPath).catch(() => {})
}

function onClose(relPath: string) {
  store.closeFile(relPath)
}
</script>

<template>
  <div v-if="store.openFiles.length" class="file-tabs">
    <div
      v-for="f in store.openFiles"
      :key="f.relPath"
      class="tab"
      :class="{ active: store.activeRelPath === f.relPath }"
      :title="f.relPath"
      @click="activate(f.relPath)"
    >
      <span v-if="f.dirty" class="dirty-dot" />
      <Icon name="file-text" :size="13" />
      <span class="tab-name">{{ basename(f.relPath) }}</span>
      <button
        v-if="f.externalChanged"
        class="reload-btn"
        title="重新加载（放弃本地改动）"
        @click.stop="onReload(f.relPath)"
      >
        <Icon name="warning" :size="12" />
        <span>重新加载</span>
      </button>
      <button class="close-btn" title="关闭" @click.stop="onClose(f.relPath)">
        <Icon name="close" :size="12" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.file-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  padding: 0 6px;
  overflow-x: auto;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 6px 0 8px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-body-sm);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.tab:hover { background: var(--tab-hover-bg); color: var(--text-primary); }
.tab.active { background: var(--accent-soft-bg); color: var(--text-primary); }
.dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--status-error);
}
.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}
.reload-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--status-warn);
  background: var(--status-warn-soft);
  cursor: pointer;
}
.reload-btn:hover { background: var(--status-warn-bg); }
.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  background: transparent;
  cursor: pointer;
}
.close-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
</style>
