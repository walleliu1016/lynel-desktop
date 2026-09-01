<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import { pushToast } from '../../composables/useToast'
import { useFilesStore, type OpenFile } from '../../stores/files'

// 注意：monaco-editor 0.56 的 exports 映射为 "./*" -> "./esm/vs/*.js"，会在 `*` 前拼接 esm/vs 前缀。
// Vite 8（Rolldown）严格按 exports 解析，`monaco-editor/esm/vs/...` 会被解析成不存在的 `esm/vs/esm/vs/...` 而报错。
// 因此这里去掉 `esm/vs` 前缀，让 `*` 捕获 `editor/editor.worker`，解析到 `./esm/vs/editor/editor.worker.js`。
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

type Monaco = typeof import('monaco-editor')
type StandaloneEditor = import('monaco-editor').editor.IStandaloneCodeEditor
type ITextModel = import('monaco-editor').editor.ITextModel

const store = useFilesStore()
const editorEl = ref<HTMLElement | null>(null)

// 懒加载单例：monaco 模块只在首次需要时 import；同一时刻只维护一个 live 编辑器
let monacoModule: Monaco | null = null
let editor: StandaloneEditor | null = null
let editorHost: HTMLElement | null = null // 编辑器绑定到的宿主元素（v-if 分支切换后可能重建）
let model: ITextModel | null = null
let activeModelRelPath: string | null = null

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

async function ensureMonaco(): Promise<Monaco | null> {
  if (monacoModule) return monacoModule
  const m = await import('monaco-editor')
  self.MonacoEnvironment = {
    getWorker(_: string, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    },
  }
  monacoModule = m
  return m
}

async function ensureEditor(): Promise<StandaloneEditor | null> {
  const m = await ensureMonaco()
  const el = editorEl.value
  if (!m || !el) return null
  if (editor && editorHost === el) return editor
  // 首次创建，或宿主元素随 v-if 分支重建后重新创建（同一时刻仍只有 1 个 live 编辑器）
  if (editor) editor.dispose()
  editor = m.editor.create(el, {
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 12,
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

onMounted(async () => {
  await nextTick()
  await switchModel()
})

onBeforeUnmount(() => {
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
