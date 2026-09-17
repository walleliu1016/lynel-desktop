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
/** 「无内容可显示」（二进制）时隐藏 diff 宿主区，避免提示条下方还挂着上一次的 diff。
 *  截断提示不置此标志：截断内容仍要显示，提示条只是说明它不完整。 */
const hostHidden = ref(false)

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
  if (!settings.cfg) {
    await settings.load()
    // await 期间并发的那次 load 可能已创建编辑器，复检避免同一宿主上建出两个实例（后者泄漏）
    if (diffEditor) return diffEditor
  }
  await syncTheme()
  if (diffEditor) return diffEditor
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
  // 先解绑再释放：否则 diffEditor 会继续持有一个已 dispose 的 model 引用
  diffEditor?.setModel(null)
  originalModel?.dispose()
  modifiedModel?.dispose()
  originalModel = null
  modifiedModel = null
}

/** 归一化后的单侧 diff 内容 */
interface DiffSide { ok: boolean; content: string; binary: boolean; truncated: boolean; error: string }

/** 归一化两侧取数结果。
 *  GitFileAtRev 返回 `{ ok: true, content, binary, truncated } | { ok: false, error }`（有 ok 判别字段）；
 *  FileRead 返回 `{ content, size, binary, truncated }`（成功即内容，**没有** ok）。
 *  两者形状不同，靠 `'ok' in res` 按真实形状区分，避免拿 ok 去解 FileRead 导致恒假（右栏恒空）。 */
function normalizeSide(
  res: Awaited<ReturnType<typeof GitFileAtRev>> | Awaited<ReturnType<typeof FileRead>>,
): DiffSide {
  if ('ok' in res) {
    return res.ok
      ? { ok: true, content: res.content, binary: res.binary, truncated: res.truncated, error: '' }
      : { ok: false, content: '', binary: false, truncated: false, error: res.error }
  }
  return { ok: true, content: res.content, binary: res.binary, truncated: res.truncated, error: '' }
}

/** 加载序号：快速连点不同文件时，旧的一次 load 在 await 返回后必须发现自己已被取代，
 *  否则会为旧文件建 model（永不 dispose，泄漏）并可能覆盖新文件已显示的内容。 */
let loadSeq = 0

async function load() {
  const req = files.diffRequest
  const wd = files.workDir
  if (!req || !wd) return

  const seq = ++loadSeq
  // 提到入口：首次打开要 settings.load() + 动态 import monaco，期间给用户加载提示
  loading.value = true
  errorMsg.value = ''
  notice.value = ''
  hostHidden.value = false

  try {
    const ed = await ensureEditor()
    // 必须重新 await ensureMonaco()，不能读模块级的 monacoModule ——
    // watch 触发的 load 可能早于组件首次挂载时那次赋值的完成
    const m = await ensureMonaco()
    if (seq !== loadSeq) return
    if (!ed || !m) return

    const [leftRaw, rightRaw] = await Promise.all([
      GitFileAtRev(wd, req.left, req.relPath),
      // FileRead 失败是 reject（删除态的工作区文件已不在磁盘）。这里归一为 null，
      // 与 GitFileAtRev 的 ok:false 一起走「右侧缺失」分支，避免 reject 冒泡进 catch
      // 变成一条原始英文 fatal（ENOENT: no such file or directory...）。
      req.right === 'WORKTREE'
        ? FileRead(wd, req.relPath).catch(() => null)
        : GitFileAtRev(wd, req.right, req.relPath),
    ])
    // 取数是最慢的一步，这里最可能被取代：丢弃刚取到的内容，不要再建 model
    if (seq !== loadSeq) return

    // 归一化：左侧总是 GitFileAtRev（HEAD），右侧可能是 GitFileAtRev（:0）/ FileRead（工作区）/
    // null（FileRead 失败）。右侧为 null 时按「取不到内容」处理，content 为空。
    const left = normalizeSide(leftRaw)
    const right: DiffSide = rightRaw
      ? normalizeSide(rightRaw)
      : { ok: false, content: '', binary: false, truncated: false, error: '' }

    // 左侧不存在是正常的（新增文件还没提交过）→ 归一化为空内容。
    // 只有左右两侧都取不到，才是真错误。
    if (!left.ok && !right.ok) {
      errorMsg.value = `无法读取文件内容：${right.error || left.error}`
      return
    }
    // 右侧取不到 = 删除态（未暂存的 D 走 FileRead、已暂存的 D 走 :0，index/工作区都已无该文件）。
    // 降级为空内容继续建 model → 用户看到的是「整文件被删」的 diff，而不是一条英文 fatal。
    if (!right.ok) notice.value = '文件已删除，右侧内容为空'
    if (left.binary || right.binary) {
      notice.value = '二进制文件，无法显示 diff'
      hostHidden.value = true
      return
    }
    if (left.truncated || right.truncated) {
      notice.value = '文件过大，仅显示截断内容'
    }

    // 确认本次是最新加载、且确实要建 model 后，才释放旧 model（先解绑再 dispose）。
    // 放在 await 之后是为了避免：被取代的那次 load 误 dispose 当前正在显示的 model。
    disposeModels()

    const lang = languageFor(req.relPath)
    const uriBase = `file:///${req.relPath}`
    // 两侧 URI 必须互不相同。未暂存的 diff 两侧 rev 都是 'HEAD'（HEAD ↔ 工作区），
    // 只用 `?rev=` 会让 original / modified 解析成同一个 URI；Monaco 的 ModelService
    // 对同一 URI 只允许一个 model，第二次 createModel 直接抛
    // 「Cannot add model because it already exists!」。加 `side` 区分两侧。
    // 建 model 前顺带清掉同 URI 的孤儿 model：正常路径由 disposeModels() 释放，
    // 但 HMR / 异常路径可能漏掉，留着会让这里再次撞车。
    const makeModel = (
      content: string,
      rev: string,
      side: 'original' | 'modified',
    ): ITextModel => {
      const uri = m.Uri.parse(`${uriBase}?rev=${rev}&side=${side}`)
      m.editor.getModel(uri)?.dispose()
      return m.editor.createModel(content, lang, uri)
    }
    originalModel = makeModel(left.content, req.left, 'original')
    modifiedModel = makeModel(right.content, req.right, 'modified')
    ed.setModel({ original: originalModel, modified: modifiedModel })
  } catch (e: any) {
    // 与 try 内一致：被取代的那次加载不得再覆盖画面（errorMsg 在模板里优先于宿主区，
    // 会把新文件已加载好的 diff 遮掉）
    if (seq !== loadSeq) return
    // 原始 message 多为英文（如 IPC 层的异常），补一句中文说明再上屏
    errorMsg.value = `加载 diff 失败：${e?.message ?? String(e)}`
  } finally {
    // 只有本次仍是最新加载时才复位 loading，否则会把后续加载的 loading 提前关掉
    if (seq === loadSeq) loading.value = false
  }
}

// diff 请求变化 → 重新加载；workDir 变化（切会话）时 store 已清空 diffRequest
watch(() => files.diffRequest, async () => {
  await nextTick()
  await load()
}, { deep: true })

// 与 CodeEditor 对称：从文件 tab 切回 diff tab 时容器刚从 display:none 恢复，
// 主动补一次 layout，避免 Monaco 停在隐藏期间算出的 0×0 尺寸上。
watch(() => files.activeView, async (v) => {
  if (v !== 'diff') return
  await nextTick()
  requestAnimationFrame(() => diffEditor?.layout())
})

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
      <span class="diff-rev">{{ files.diffRequest?.left }} ↔ {{ files.diffRequest?.label }}</span>
      <span class="bar-spacer" />
      <button class="bar-btn" title="关闭 diff" @click="files.closeDiff()">
        <Icon name="close" :size="13" />
      </button>
    </div>
    <div v-if="loading" class="diff-hint">正在加载…</div>
    <div v-else-if="errorMsg" class="diff-hint error">{{ errorMsg }}</div>
    <div v-else-if="notice" class="diff-hint">{{ notice }}</div>
    <!-- 无内容可显示（loading/错误/二进制）时隐藏宿主区，避免提示条下方还挂着上一次的 diff 内容。
         用 v-show 而非 v-if：销毁宿主 DOM 会连带 Monaco 编辑器一起重建。 -->
    <div v-show="!loading && !errorMsg && !hostHidden" ref="hostEl" class="diff-host" />
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
