<script lang="ts">
import type { InjectionKey, Ref } from 'vue'

// 递归组件共享上下文类型：根实例 provide，子实例 inject，保证全局只有一行在编辑、一个菜单在展示
interface EditState {
  kind: 'create' | 'rename'
  parentRel: string // create: 父目录 relPath；rename: 旧条目的父目录 relPath
  isDir: boolean
  name: string // 输入框当前值
  oldRel?: string // rename 时的旧 relPath
}
interface MenuState {
  x: number
  y: number
  relPath: string
  name: string
  isDir: boolean
  parentRel: string
}
interface TreeRowCtx {
  editing: Ref<EditState | null>
  menu: Ref<MenuState | null>
}

// 注入键必须声明在普通 <script> 块（模块顶层）：<script setup> 内的 const 会被编译器
// 搬进 setup 作用域，每个实例重新 Symbol() 产生不同 symbol，导致 provide/inject 链断裂、
// 递归组件无限挂载（Maximum call stack size exceeded）
const TREE_ROW_CTX: InjectionKey<TreeRowCtx> = Symbol('tree-row-ctx')
</script>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import { useFilesStore, type TreeEntry } from '../../stores/files'

// 递归组件自引用：模板内 <TreeRow> 需解析到本组件自身（Vue 3.5 官方机制）
defineOptions({ name: 'TreeRow' })

const store = useFilesStore()

const injectCtx = inject(TREE_ROW_CTX, null)
const editing = injectCtx ? injectCtx.editing : ref<EditState | null>(null)
const menu = injectCtx ? injectCtx.menu : ref<MenuState | null>(null)
if (!injectCtx) provide(TREE_ROW_CTX, { editing, menu })
const isRoot = !injectCtx

const props = defineProps<{ relPath: string; depth: number }>()

// ---------- 树数据 ----------
const entries = computed<TreeEntry[]>(() => store.tree[props.relPath] ?? [])

function entryRel(entry: TreeEntry): string {
  return props.relPath ? `${props.relPath}/${entry.name}` : entry.name
}

// ---------- 行交互 ----------
function onRowClick(entry: TreeEntry) {
  if (editing.value) return // 编辑态下避免误触
  const rel = entryRel(entry)
  if (entry.isDir) store.toggleExpand(rel, true)
  else store.openFile(rel)
}

function openMenu(e: MouseEvent, entry: TreeEntry) {
  // fixed 定位浮层，边缘处收拢避免溢出视口
  menu.value = {
    x: Math.min(e.clientX, window.innerWidth - 150),
    y: Math.min(e.clientY, window.innerHeight - 150),
    relPath: entryRel(entry),
    name: entry.name,
    isDir: entry.isDir,
    parentRel: props.relPath,
  }
}

function closeMenu() {
  menu.value = null
}

// ---------- 行内编辑 ----------
function isEditingEntry(entry: TreeEntry): boolean {
  return editing.value?.kind === 'rename' && editing.value.oldRel === entryRel(entry)
}

/** 当前目录处于「新建」态（输入行显示在子列表末尾） */
const creatingHere = computed(() => editing.value?.kind === 'create' && editing.value.parentRel === props.relPath)

function startCreate(parentRel: string, isDir: boolean) {
  if (!store.expanded.has(parentRel)) store.toggleExpand(parentRel, true) // 展开以显示输入行
  editing.value = { kind: 'create', parentRel, isDir, name: isDir ? 'new-folder' : 'untitled.ts' }
}

/** Enter 提交：名称空或未变化则直接取消；失败提示由 store 内部负责 */
function submitEdit() {
  const e = editing.value
  if (!e) return
  const name = e.name.trim()
  editing.value = null
  if (!name) return
  if (e.kind === 'rename') {
    const oldName = e.oldRel ? e.oldRel.slice(e.oldRel.lastIndexOf('/') + 1) : ''
    if (name !== oldName) store.renameEntry(e.oldRel ?? '', name)
  } else {
    store.createEntry(e.parentRel, name, e.isDir)
  }
}

function cancelEdit() {
  editing.value = null
}

// ---------- 菜单动作 ----------
function menuNewFile() {
  const m = menu.value
  if (!m) return
  closeMenu()
  startCreate(m.parentRel, false)
}
function menuNewFolder() {
  const m = menu.value
  if (!m) return
  closeMenu()
  startCreate(m.parentRel, true)
}
function menuRename() {
  const m = menu.value
  if (!m) return
  closeMenu()
  editing.value = { kind: 'rename', parentRel: m.parentRel, isDir: m.isDir, name: m.name, oldRel: m.relPath }
}
function menuDelete() {
  const m = menu.value
  if (!m) return
  closeMenu()
  store.deleteEntry(m.relPath)
}

// ---------- 点外部关闭菜单（仅根实例挂监听） ----------
const menuEl = ref<HTMLElement | null>(null)
if (isRoot) {
  onMounted(() => {
    document.addEventListener('click', onDocClick)
    document.addEventListener('contextmenu', onDocCtx)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('contextmenu', onDocCtx)
  })
}
function onDocClick(e: MouseEvent) {
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) closeMenu()
}
function onDocCtx() {
  closeMenu()
}

// ---------- 编辑态下自动聚焦输入框 ----------
const editInput = ref<HTMLInputElement | null>(null)
// watch 负责：编辑态在已挂载的行上切换时聚焦（重命名/展开目录中新建）
watch(editing, async () => {
  await nextTick()
  const el = editInput.value
  if (el) {
    el.focus()
    el.select()
  }
})
// 折叠目录中新建时，子实例在编辑态设置后才挂载，watch 不会触发，需在挂载后补一次聚焦
onMounted(() => {
  if (creatingHere.value) editInput.value?.focus()
})

// 工具条「新建文件」按钮联动：+1 时在树根（relPath==='' 的递归实例）弹行内输入。
// 根实例 relPath 为 undefined（只渲染容器），不响应；仅 v > old 防止 setSession 清零造成误触发。
watch(
  () => store.rootCreateRequest,
  (v, old) => {
    if (v > old && props.relPath === '') startCreate('', false)
  },
)
</script>

<template>
  <!-- 根实例：外层容器 + 空状态 + 右键浮层 -->
  <div v-if="isRoot" class="file-tree" @contextmenu.prevent>
    <div v-if="!store.workDir" class="tree-empty">无工作目录</div>
    <div v-else-if="!store.tree['']?.length" class="tree-empty">空</div>
    <TreeRow v-else :rel-path="''" :depth="0" />

    <div
      v-if="menu"
      ref="menuEl"
      class="ctx-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
    >
      <div v-if="menu.isDir" class="menu-item" @click="menuNewFile()">
        <Icon name="file-text" :size="13" />
        <span>新建文件</span>
      </div>
      <div v-if="menu.isDir" class="menu-item" @click="menuNewFolder()">
        <Icon name="folder-open" :size="13" />
        <span>新建文件夹</span>
      </div>
      <div class="menu-item" @click="menuRename()">
        <Icon name="pencil" :size="13" />
        <span>重命名</span>
      </div>
      <div class="menu-item danger" @click="menuDelete()">
        <Icon name="trash" :size="13" />
        <span>删除</span>
      </div>
    </div>
  </div>

  <!-- 递归实例：渲染本目录的条目行 -->
  <div v-else class="dir-node">
    <template v-for="entry in entries" :key="entry.name">
      <div
        class="row"
        :class="{
          'is-dir': entry.isDir,
          active: !entry.isDir && store.activeRelPath === entryRel(entry),
        }"
        :style="{ paddingLeft: depth * 12 + 'px' }"
        @click="onRowClick(entry)"
        @contextmenu.prevent.stop="openMenu($event, entry)"
      >
        <template v-if="editing && isEditingEntry(entry)">
          <Icon :name="entry.isDir ? 'folder-open' : 'file-text'" :size="14" />
          <input
            ref="editInput"
            v-model="editing.name"
            class="row-input"
            spellcheck="false"
            @click.stop
            @contextmenu.stop
            @keydown.enter.prevent="submitEdit()"
            @keydown.esc.prevent="cancelEdit()"
            @blur="submitEdit()"
          />
        </template>
        <template v-else>
          <span class="chevron">
            <Icon
              :name="entry.isDir && store.expanded.has(entryRel(entry)) ? 'chevron-down' : (entry.isDir ? 'chevron-right' : '')"
              :size="13"
            />
          </span>
          <Icon :name="entry.isDir ? 'folder-open' : 'file-text'" :size="14" />
          <span class="name" :title="entry.name">{{ entry.name }}</span>
        </template>
      </div>

      <!-- 展开的子目录递归渲染 -->
      <TreeRow
        v-if="entry.isDir && store.expanded.has(entryRel(entry))"
        :rel-path="entryRel(entry)"
        :depth="depth + 1"
      />
    </template>

    <!-- 新建条目 ghost 行 -->
    <div v-if="creatingHere && editing" class="row creating" :style="{ paddingLeft: depth * 12 + 'px' }">
      <Icon :name="editing.isDir ? 'folder-open' : 'file-text'" :size="14" />
      <input
        ref="editInput"
        v-model="editing.name"
        class="row-input"
        spellcheck="false"
        @click.stop
        @contextmenu.stop
        @keydown.enter.prevent="submitEdit()"
        @keydown.esc.prevent="cancelEdit()"
        @blur="submitEdit()"
      />
    </div>
  </div>
</template>

<style scoped>
.file-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 4px;
  background: var(--bg-panel);
}
.tree-empty {
  padding: 16px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
}
.dir-node { min-height: 0; }
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding-right: 8px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-body-sm);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.row:hover { background: var(--bg-hover); color: var(--text-primary); }
.row.active { background: var(--accent-soft-bg); color: var(--text-primary); }
.row.creating { cursor: default; }
.chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex-shrink: 0;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.row-input {
  flex: 1;
  min-width: 0;
  height: 20px;
  padding: 0 6px;
  font-size: var(--fs-body-sm);
  color: var(--text-primary);
  background: var(--bg-input);
  border: 1px solid var(--border-focus);
  border-radius: var(--radius-sm);
  outline: none;
}
.ctx-menu {
  position: fixed;
  z-index: 1000;
  min-width: 136px;
  padding: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-panel);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-body-sm);
  color: var(--text-secondary);
  cursor: pointer;
}
.menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.menu-item.danger { color: var(--status-error); }
.menu-item.danger:hover { background: var(--status-error-soft); }
</style>
