<script setup lang="ts">
import { computed, watch } from 'vue'
import Icon from '../Icon.vue'
import FileTree from './FileTree.vue'
import FileEditorPanel from './FileEditorPanel.vue'
import BottomPanel from './BottomPanel.vue'
import { useFilesStore } from '../../stores/files'
import { useGitStore } from '../../stores/git'

/** 右栏是否可见（由 HomeView 传 splitOpen）。CodeView 被 v-show 常挂载，
 *  自身感知不到展开/收起，底部面板的终端要据此决定是否启动。 */
const props = withDefaults(defineProps<{
  visible?: boolean
}>(), { visible: true })

const store = useFilesStore()
const gitStore = useGitStore()

// 会话切换 → git 面板跟着换目录并重挂 .git watcher
watch(
  () => store.workDir,
  (wd) => { void gitStore.setSession(wd) },
  { immediate: true },
)

/** 项目目录 basename（title 展示完整路径） */
const dirName = computed(() => {
  const wd = store.workDir
  if (!wd) return ''
  return wd.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? wd
})

// ---------- 工具条动作 ----------
function onRefresh() {
  const dirs = new Set([''])
  for (const d of store.expanded) dirs.add(d)
  void Promise.all(Array.from(dirs).map((d) => store.loadDir(d).catch(() => {})))
}

function onNewFile() {
  store.rootCreateRequest++
}

function onCollapse() {
  store.collapsed = true
}
// 树重新展开的唯一入口是右栏顶部行的「文件」标识 tab（RightWorkspacePane 翻转本 store），
// 这里不提供第二个展开按钮（左缘竖条 .tree-collapsed 已删）
</script>

<template>
  <div class="code-view code-workspace-theme">
    <div class="main-row">
      <aside v-if="!store.collapsed" class="tree-panel">
        <div class="panel-toolbar">
          <button class="tool-btn" title="刷新文件树" aria-label="刷新文件树" @click="onRefresh">
            <Icon name="refresh-cw" :size="14" />
          </button>
          <button class="tool-btn" title="新建文件" aria-label="新建文件" @click="onNewFile">
            <Icon name="plus" :size="14" />
          </button>
          <span class="toolbar-dir" :title="store.workDir">{{ dirName }}</span>
          <span class="toolbar-spacer" />
          <button class="tool-btn" title="折叠文件树" aria-label="折叠文件树" @click="onCollapse">
            <Icon name="panel-left-close" :size="14" />
          </button>
        </div>
        <FileTree :rel-path="''" :depth="0" />
      </aside>
      <!-- 树折叠态：不渲染任何竖条/展开按钮，编辑器区占满 main-row；展开走右栏「文件」tab -->
      <FileEditorPanel />
    </div>
    <BottomPanel
      :session-id="store.currentSessionId"
      :work-dir="store.workDir"
      :visible="props.visible"
    />
  </div>
</template>

<style scoped>
.code-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  overflow: hidden;
}
.main-row {
  flex: 1;
  min-height: 0;
  display: flex;
}
.tree-panel {
  position: relative;
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
}
.panel-toolbar {
  height: 32px;
  min-height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
  border-bottom: 1px solid var(--border);
  user-select: none;
}
.tool-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}
.tool-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
.toolbar-spacer { flex: 1; }
.toolbar-dir {
  margin-left: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-caption);
  color: var(--term-bright-black);
}
</style>
