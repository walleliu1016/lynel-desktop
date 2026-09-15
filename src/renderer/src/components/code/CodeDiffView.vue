<script setup lang="ts">
import { onBeforeUnmount, ref, watch, nextTick } from 'vue'
import Icon from '../Icon.vue'
import { FileRead, GitFileAtRev } from '../../composables/useElectron'
import { useFilesStore } from '../../stores/files'
import { useSettingsStore } from '../../stores/settings'
import { ensureMonaco, applyMonacoTheme } from '../../monaco/setup'

type DiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor
type ITextModel = import('monaco-editor').editor.ITextModel

const files = useFilesStore()
const settings = useSettingsStore()

const hostEl = ref<HTMLElement | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const notice = ref('') // 二进制 / 超大文件提示

let diffEditor: DiffEditor | null = null
let originalModel: ITextModel | null = null
let modifiedModel: ITextModel | null = null
let currentThemeName = 'code-default-dark'

function languageFor(relPath: string): string {
  if (relPath.endsWith('.ts') || relPath.endsWith('.tsx')) return 'typescript'
  if (relPath.endsWith('.js') || relPath.endsWith('.jsx')) return 'javascript'
  if (relPath.endsWith('.vue')) return 'html'
  if (relPath.endsWith('.json')) return 'json'
  if (relPath.endsWith('.md')) return 'markdown'
  if (relPath.endsWith('.py')) return 'python'
  if (relPath.endsWith('.css')) return 'css'
  if (relPath.endsWith('.html')) return 'html'
  return 'plaintext'
}

/** 应用到 Monaco 主题：与 CodeEditor 同源（都读 --term-*）。
 *  applyMonacoTheme 只构建并返回主题名，不负责应用，需调用方自行 setTheme。 */
async function syncTheme() {
  const m = await ensureMonaco()
  if (!m) return
  const theme = settings.cfg?.terminal.theme ?? 'default-dark'
  currentThemeName = applyMonacoTheme(m, theme)
  m.editor.setTheme(currentThemeName)
}

async function ensureEditor(): Promise<DiffEditor | null> {
  const m = await ensureMonaco()
  const el = hostEl.value
  if (!m || !el) return null
  if (diffEditor) return diffEditor
  if (!settings.cfg) await settings.load()
  await syncTheme()
  diffEditor = m.editor.createDiffEditor(el, {
    theme: currentThemeName,
    automaticLayout: true,
    readOnly: true,
    renderSideBySide: true,
    fontSize: settings.cfg?.code?.fontSize ?? 12,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
  })
  return diffEditor
}

function disposeModels() {
  originalModel?.dispose()
  modifiedModel?.dispose()
  originalModel = null
  modifiedModel = null
}

async function load() {
  const req = files.diffRequest
  const wd = files.workDir
  if (!req || !wd) return

  const ed = await ensureEditor()
  // 必须重新 await ensureMonaco()，不能读模块级的 monacoModule ——
  // watch 触发的 load 可能早于组件首次挂载时那次赋值的完成
  const m = await ensureMonaco()
  if (!ed || !m) return

  loading.value = true
  errorMsg.value = ''
  notice.value = ''
  disposeModels()

  try {
    const [left, right] = await Promise.all([
      GitFileAtRev(wd, 'HEAD', req.relPath),
      req.rev === ':0' ? GitFileAtRev(wd, ':0', req.relPath) : FileRead(wd, req.relPath),
    ])

    // 左侧不存在是正常的（新增文件还没提交过）→ 用空内容。
    // 右侧为 index 内容时读取失败才是真错误（例如文件已被删除）。
    const leftOk = left.ok
    const rightOk = right.ok
    if (!rightOk && req.rev === ':0') {
      errorMsg.value = right.error
      return
    }

    const leftBinary = leftOk && left.binary
    const rightBinary = right.ok && right.binary
    if (leftBinary || rightBinary) {
      notice.value = '二进制文件，无法显示 diff'
      return
    }
    const leftTruncated = leftOk && left.truncated
    const rightTruncated = right.ok && right.truncated
    if (leftTruncated || rightTruncated) {
      notice.value = '文件过大，仅显示截断内容'
    }

    const lang = languageFor(req.relPath)
    const uriBase = `file:///${req.relPath}`
    originalModel = m.editor.createModel(
      leftOk ? left.content : '',
      lang,
      m.Uri.parse(`${uriBase}?rev=HEAD`),
    )
    modifiedModel = m.editor.createModel(
      right.ok ? right.content : '',
      lang,
      m.Uri.parse(`${uriBase}?rev=${req.rev}`),
    )
    ed.setModel({ original: originalModel, modified: modifiedModel })
  } catch (e: any) {
    errorMsg.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
}

// diff 请求变化 → 重新加载；workDir 变化（切会话）时 store 已清空 diffRequest
watch(() => files.diffRequest, async () => {
  await nextTick()
  await load()
}, { deep: true })

watch(() => settings.cfg?.terminal.theme, () => { void syncTheme() })

onBeforeUnmount(() => {
  disposeModels()
  diffEditor?.dispose()
  diffEditor = null
})

// 首次挂载。父组件用 v-show 控制显隐，所以本组件拿到 diffRequest 时已经非空
void (async () => {
  await ensureMonaco()
  await nextTick()
  await load()
})()
</script>

<template>
  <div class="diff-view">
    <div class="diff-bar">
      <Icon name="git-compare" :size="13" />
      <span class="diff-path" :title="files.diffRequest?.relPath ?? ''">
        {{ files.diffRequest?.relPath }}
      </span>
      <span class="diff-rev">{{ files.diffRequest?.rev === ':0' ? '暂存区' : '工作区' }} ↔ HEAD</span>
      <span class="bar-spacer" />
      <button class="bar-btn" title="关闭 diff" @click="files.closeDiff()">
        <Icon name="close" :size="13" />
      </button>
    </div>
    <div v-if="loading" class="diff-hint">正在加载…</div>
    <div v-else-if="errorMsg" class="diff-hint error">{{ errorMsg }}</div>
    <div v-else-if="notice" class="diff-hint">{{ notice }}</div>
    <div ref="hostEl" class="diff-host" />
  </div>
</template>

<style scoped>
.diff-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}
.diff-bar {
  height: 32px;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  user-select: none;
}
.diff-path { color: var(--text-primary); }
.diff-rev { color: var(--text-tertiary); }
.bar-spacer { flex: 1; }
.bar-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.bar-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
.diff-hint {
  padding: 8px 12px;
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.diff-hint.error { color: var(--status-error); }
.diff-host {
  flex: 1;
  min-height: 0;
}
</style>
