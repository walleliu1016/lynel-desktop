<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../Icon.vue'
import { useFilesStore } from '../../stores/files'

const store = useFilesStore()

function basename(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1)
}

/** diff tab 的对比说明，直接取自 diffRequest（工作区 / 暂存区 / 短 hash） */
const diffLabel = computed(() => store.diffRequest?.label ?? '')

function onReload(relPath: string) {
  void store.reloadFile(relPath).catch(() => {})
}

function onClose(relPath: string) {
  store.closeFile(relPath)
}
</script>

<template>
  <div v-if="store.openFiles.length || store.diffRequest" class="file-tabs">
    <!-- 可滚动的 tab 区。右侧的开关按钮必须留在滚动容器之外，
         否则 tab 一多就被推出视口、点不到了 -->
    <div class="tab-scroll">
      <div
        v-for="f in store.openFiles"
        :key="f.relPath"
        class="tab"
        :class="{ active: store.activeView === 'file' && store.activeRelPath === f.relPath }"
        :title="f.relPath"
        @click="store.activateFile(f.relPath)"
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
      <!-- diff tab：与文件 tab 并列，可随时切回文件而不必关掉它 -->
      <div
        v-if="store.diffRequest"
        class="tab"
        :class="{ active: store.activeView === 'diff' }"
        :title="`${store.diffRequest.relPath} · ${diffLabel}`"
        @click="store.activeView = 'diff'"
      >
        <Icon name="git-compare" :size="13" />
        <span class="tab-name">{{ basename(store.diffRequest.relPath) }}</span>
        <span class="tab-rev">{{ diffLabel }}</span>
        <button class="close-btn" title="关闭 diff" @click.stop="store.closeDiff()">
          <Icon name="close" :size="12" />
        </button>
      </div>
    </div>
    <!-- 行内 blame 开关：打开后当前光标行尾显示作者 / 时间 / 短 hash -->
    <button
      class="bar-toggle"
      :class="{ on: store.blameEnabled }"
      :title="store.blameEnabled ? '关闭行内 blame' : '显示行内 blame（光标所在行）'"
      @click="store.blameEnabled = !store.blameEnabled"
    >
      <Icon name="history" :size="13" />
    </button>
  </div>
</template>

<style scoped>
.file-tabs {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 6px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.tab-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
}
.bar-toggle {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.bar-toggle:hover { background: var(--bg-hover); color: var(--text-primary); }
.bar-toggle.on { color: var(--accent); }
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
/* diff tab 的对比对象标签（暂存区 / HEAD） */
.tab-rev {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-tertiary);
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
