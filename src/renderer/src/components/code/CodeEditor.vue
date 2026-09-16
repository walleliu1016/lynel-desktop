<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import { pushToast } from '../../composables/useToast'
import { useFilesStore, type OpenFile } from '../../stores/files'
import { useSettingsStore } from '../../stores/settings'
import { ensureMonaco, applyMonacoTheme, currentThemeId } from '../../monaco/setup'

type StandaloneEditor = import('monaco-editor').editor.IStandaloneCodeEditor
type ITextModel = import('monaco-editor').editor.ITextModel

const store = useFilesStore()
const settings = useSettingsStore()
const editorEl = ref<HTMLElement | null>(null)

// 同一时刻只维护一个 live 编辑器
let editor: StandaloneEditor | null = null
let editorHost: HTMLElement | null = null // 编辑器绑定到的宿主元素（v-if 分支切换后可能重建）
let model: ITextModel | null = null
let activeModelRelPath: string | null = null

// 当前 Monaco 主题名。编辑器创建时使用；终端主题变化时重建。
let currentThemeName = 'code-default-dark'

/**
 * 窗口恢复可见时补一次 layout，触发 Monaco 重渲染。
 * Monaco 的行内容（文字 + 行号）由 requestAnimationFrame 调度渲染，而窗口处于
 * 隐藏/最小化/托盘时 Chromium 会暂停 rAF（document.visibilityState === 'hidden'），
 * 此时创建或更新编辑器只建出空壳：有 .monaco-editor 与 .view-lines，但没有一行内容，
 * 且容器尺寸不变不会再触发 automaticLayout 的 ResizeObserver，窗口恢复后也不会自愈。
 * 表现即「文件子页整块空白、行号都没有」。
 */
function relayoutOnVisible() {
  if (document.visibilityState !== 'visible' || !editor) return
  requestAnimationFrame(() => editor?.layout())
}

// 草稿持有权在 files store（store.drafts）：store.content 是「上次保存/加载」的基准内容，
// 跨 tab 切换 / 组件卸载（折叠、离页）时用它恢复未保存编辑
const activeFile = computed<OpenFile | null>(
  () => store.openFiles.find((o) => o.relPath === store.activeRelPath) ?? null,
)

function languageFor(relPath: string): string {
  if (relPath.endsWith('.ts') || relPath.endsWith('.tsx')) return 'typescript'
  if (relPath.endsWith('.js') || relPath.endsWith('.jsx')) return 'javascript'
  if (relPath.endsWith('.vue')) return 'html'
  if (relPath.endsWith('.json')) return 'json'
  if (relPath.endsWith('.md')) return 'markdown'
  if (relPath.endsWith('.py')) return 'python'
  if (relPath.endsWith('.yaml') || relPath.endsWith('.yml')) return 'yaml'
  if (relPath.endsWith('.css')) return 'css'
  if (relPath.endsWith('.html')) return 'html'
  return 'plaintext'
}

/** 应用当前终端主题：由 monaco/setup 构建主题（内部同步 data-term-theme 并读 CSS 变量）并应用到 live 编辑器。
 *  settings.cfg.terminal.theme 由 watch 触发时已是新值；未加载时回退 data-term-theme 属性。 */
async function applyThemeToEditor() {
  const m = await ensureMonaco()
  if (!m) return
  const theme = settings.cfg?.terminal.theme ?? currentThemeId()
  currentThemeName = applyMonacoTheme(m, theme)
  // 切换主题用全局 monaco.editor.setTheme（IStandaloneCodeEditor 无实例级 setTheme）
  if (editor) m.editor.setTheme(currentThemeName)
}

async function ensureEditor(): Promise<StandaloneEditor | null> {
  const m = await ensureMonaco()
  const el = editorEl.value
  if (!m || !el) return null
  if (!settings.cfg) await settings.load()
  if (editor && editorHost === el) return editor
  // 首次创建，或宿主元素随 v-if 分支重建后重新创建（同一时刻仍只有 1 个 live 编辑器）
  if (editor) editor.dispose()
  // 先同步主题（可能已由 watch 更新过 currentThemeName，也可能需要初始化）
  await applyThemeToEditor()
  editor = m.editor.create(el, {
    theme: currentThemeName,
    automaticLayout: true,
    fontSize: settings.cfg?.code?.fontSize ?? 12,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 2,
  })
  editorHost = el
  editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => { void saveActive() })
  return editor
}

/** model 内容变化：以 model 为准，与 store 基准内容比对后置脏，并记录草稿 */
function onModelChange(relPath: string) {
  const f = store.openFiles.find((o) => o.relPath === relPath)
  if (!f || !model) return
  f.dirty = model.getValue() !== f.content
  if (store.drafts[relPath] !== model.getValue()) {
    store.setDraft(relPath, model.getValue())
  }
}

/** 切换激活文件：先释放旧 model（仅释放编辑器持有的 model，不动 store 数据），再为新文件建 model */
async function switchModel() {
  if (model) {
    model.dispose()
    model = null
  }
  activeModelRelPath = null
  const f = activeFile.value
  if (!f || f.binary || f.truncated) {
    if (editor) editor.setModel(null)
    return
  }
  const m = await ensureMonaco()
  const ed = await ensureEditor()
  if (!m || !ed) return
  // 快速连续切 tab：await 期间激活文件可能已变化，复查避免为旧文件建 model 遗留未 dispose 的 model
  if (store.activeRelPath !== f.relPath) return
  // 有未保存改动时优先用草稿；否则用 store 基准内容（重载后 dirty=false，自然回落为磁盘内容）
  const content = f.dirty && store.drafts[f.relPath] !== undefined ? store.drafts[f.relPath]! : f.content
  const lang = languageFor(f.relPath)
  const uri = m.Uri.parse(`file:///${f.relPath}`)
  model = m.editor.createModel(content, lang, uri)
  const rel = f.relPath
  model.onDidChangeContent(() => onModelChange(rel))
  ed.setModel(model)
  activeModelRelPath = f.relPath
}

async function saveActive() {
  const f = activeFile.value
  if (!f || !model || activeModelRelPath !== f.relPath) return
  if (!f.dirty && !f.externalChanged) return
  try {
    await store.saveFile(f.relPath, model.getValue())
  } catch (e: any) {
    pushToast({ level: 'error', source: 'file', message: `保存失败：${e?.message ?? e}` })
  }
}

function onReload() {
  const rel = store.activeRelPath
  if (!rel) return
  void store.reloadFile(rel).catch(() => {})
}

// 切换激活文件：等 DOM 更新（editor-host 分支挂载/卸载）后再切 model
watch(
  () => store.activeRelPath,
  async () => {
    await nextTick()
    await switchModel()
  },
)

// 从 diff tab 切回编辑器 tab：容器刚从 display:none 恢复。Monaco 在隐藏期间会被
// 布局成 0×0，而恢复时 automaticLayout 的 ResizeObserver 未必再触发一次 ——
// 于是 model 明明还在，画面上却一行都没有（整块空白、行号也缺）。
// 切换时主动补一次 layout，不依赖自动检测。
watch(
  () => store.activeView,
  async (v) => {
    if (v !== 'file') return
    await nextTick()
    requestAnimationFrame(() => editor?.layout())
  },
)

// 外部变更 reload / 保存后 store.content 变化：model 与 store 内容不一致则同步。
// 保存场景 model 内容 === f.content（等式守卫跳过 setValue，避免重置撤销栈）；
// reload 场景 model 持有旧内容 ≠ f.content → setValue 刷成磁盘内容（放弃本地改动语义）。
watch(
  () => activeFile.value?.savedVersion,
  () => {
    const f = activeFile.value
    if (!f || !model || activeModelRelPath !== f.relPath) return
    if (model.getValue() !== f.content) model.setValue(f.content)
  },
)

// 关闭/删除文件后清理草稿由 store 统一管理（closeFile/deleteEntry/renameEntry），组件不重复处理

// 终端主题变化：重建 Monaco 主题并应用到 live 编辑器
watch(
  () => settings.cfg?.terminal.theme,
  () => { void applyThemeToEditor() },
)

// 代码编辑器字号变化：即时应用到 live 编辑器（未创建时创建已读最新值，跳过即可）
watch(
  () => settings.cfg?.code?.fontSize,
  (n) => {
    if (typeof n !== 'number') return
    if (editor) editor.updateOptions({ fontSize: n })
  },
)

onMounted(async () => {
  document.addEventListener('visibilitychange', relayoutOnVisible)
  window.addEventListener('focus', relayoutOnVisible)
  if (!settings.cfg) await settings.load()
  await nextTick()
  await switchModel()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', relayoutOnVisible)
  window.removeEventListener('focus', relayoutOnVisible)
  // 草稿留在 store，组件卸载（折叠/离页）不丢未保存编辑
  model?.dispose()
  model = null
  editor?.dispose()
  editor = null
  editorHost = null
  activeModelRelPath = null
})
</script>

<template>
  <div class="code-editor">
    <div v-if="!activeFile" class="editor-empty">从左侧文件树选择文件</div>
    <div v-else-if="activeFile.binary" class="editor-placeholder">二进制文件，无法编辑</div>
    <div v-else-if="activeFile.truncated" class="editor-placeholder">文件过大（只读，已截断显示）</div>
    <div v-else ref="editorEl" class="editor-host" />
    <div v-if="activeFile?.externalChanged" class="conflict-bar">
      <Icon name="warning" :size="13" />
      <span>文件已在外部变更</span>
      <button @click="onReload()">重新加载（放弃本地改动）</button>
    </div>
  </div>
</template>

<style scoped>
.code-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--bg-panel);
}
.editor-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-tertiary);
}
.editor-placeholder {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.editor-host {
  flex: 1;
  min-height: 0;
}
.conflict-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--status-warn);
  background: var(--status-warn-soft);
  border-top: 1px solid var(--status-warn-border);
}
.conflict-bar button {
  padding: 2px 8px;
  border: 1px solid var(--status-warn-border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--status-warn);
  background: transparent;
  cursor: pointer;
}
.conflict-bar button:hover { background: var(--status-warn-bg); }
</style>
