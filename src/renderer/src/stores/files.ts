import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  FileListDir, FileRead, FileWrite, FileCreate, FileRename, FileDelete,
  FileWatch, FileUnwatch, FileChanged,
} from '../composables/useElectron'
import { pushToast } from '../composables/useToast'

export interface TreeEntry { name: string; isDir: boolean }
export interface OpenFile {
  relPath: string
  content: string
  dirty: boolean
  binary: boolean
  truncated: boolean
  externalChanged: boolean
  savedVersion: number // 打开/保存时自增，用于区分本地改动与外部变更
}

export const useFilesStore = defineStore('files', () => {
  const workDir = ref('')
  const tree = ref<Record<string, TreeEntry[]>>({ '': [] }) // relPath -> 单层条目
  const expanded = ref<Set<string>>(new Set())
  const openFiles = ref<OpenFile[]>([])
  // 编辑器草稿（relPath -> 未保存内容）。持有权放 store：CodeEditor 折叠/离页卸载不丢草稿
  const drafts = ref<Record<string, string>>({})
  const activeRelPath = ref<string | null>(null)
  const collapsed = ref(false) // 侧栏折叠态（HomeView 持有也可，先放这里）
  const rootCreateRequest = ref(0) // 工具条「新建文件」请求计数：+1 触发树根弹行内输入

  async function setSession(wd: string) {
    if (workDir.value) await FileUnwatch(workDir.value).catch(() => {})
    workDir.value = wd
    tree.value = { '': [] }
    expanded.value = new Set()
    openFiles.value = []
    drafts.value = {} // 切会话丢弃未保存编辑（本分支 spec 首版简单化行为）
    activeRelPath.value = null
    rootCreateRequest.value = 0
    if (wd) {
      await FileWatch(wd).catch(() => {})
      await loadDir('').catch(() => {})
    }
  }

  /** 拉取单层目录（已展开时刷新用）。返回条目列表，不抛错时更新 tree。 */
  async function loadDir(relPath: string): Promise<void> {
    const wd = workDir.value
    if (!wd) return
    const entries = await FileListDir(wd, relPath || undefined)
    tree.value = { ...tree.value, [relPath]: entries }
  }

  async function toggleExpand(relPath: string, isDir: boolean) {
    if (!isDir) return
    if (expanded.value.has(relPath)) {
      expanded.value = new Set([...expanded.value].filter((p) => p !== relPath))
      return
    }
    expanded.value = new Set([...expanded.value, relPath])
    await loadDir(relPath).catch(() => {})
  }

  /** 打开文件：已在 openFiles 则仅切激活；否则读取后加入。 */
  async function openFile(relPath: string) {
    const wd = workDir.value
    if (!wd) return
    const existing = openFiles.value.find((o) => o.relPath === relPath)
    if (existing) { activeRelPath.value = relPath; return }
    const r = await FileRead(wd, relPath)
    openFiles.value = [...openFiles.value, {
      relPath, content: r.content, dirty: false, binary: r.binary,
      truncated: r.truncated, externalChanged: false, savedVersion: 0,
    }]
    activeRelPath.value = relPath
  }

  /** 写草稿（整体 spread 更新） */
  function setDraft(relPath: string, content: string) {
    drafts.value = { ...drafts.value, [relPath]: content }
  }

  /** 清草稿（仅存在时更新，避免无谓响应） */
  function clearDraft(relPath: string) {
    if (!(relPath in drafts.value)) return
    const next = { ...drafts.value }
    delete next[relPath]
    drafts.value = next
  }

  function closeFile(relPath: string) {
    const f = openFiles.value.find((o) => o.relPath === relPath)
    if (f?.dirty && !window.confirm(`「${relPath}」有未保存修改，确定关闭？`)) return
    openFiles.value = openFiles.value.filter((o) => o.relPath !== relPath)
    clearDraft(relPath)
    if (activeRelPath.value === relPath) {
      activeRelPath.value = openFiles.value[openFiles.value.length - 1]?.relPath ?? null
    }
  }

  /** 编辑器内容变化时上报（保存版本 + 当前内容）。返回新 savedVersion 供编辑器存回。 */
  async function saveFile(relPath: string, content: string): Promise<number> {
    const wd = workDir.value
    if (!wd) return 0
    await FileWrite(wd, relPath, content)
    const f = openFiles.value.find((o) => o.relPath === relPath)
    if (f) {
      f.content = content
      f.dirty = false
      f.externalChanged = false
      f.savedVersion += 1
    }
    return f?.savedVersion ?? 0
  }

  async function reloadFile(relPath: string) {
    const wd = workDir.value
    if (!wd) return
    const r = await FileRead(wd, relPath)
    const f = openFiles.value.find((o) => o.relPath === relPath)
    if (f) {
      f.content = r.content
      f.dirty = false
      f.externalChanged = false
      f.savedVersion += 1
    }
  }

  async function createEntry(parentRel: string, name: string, isDir: boolean) {
    const wd = workDir.value
    if (!wd) return
    const rel = parentRel ? `${parentRel}/${name}` : name
    try {
      await FileCreate(wd, rel, isDir)
      if (!expanded.value.has(parentRel)) expanded.value = new Set([...expanded.value, parentRel])
      await loadDir(parentRel)
    } catch (e: any) {
      // 管理操作失败由 store 负责提示，调用方无需处理
      pushToast({ level: 'error', source: 'file', message: `新建失败：${e?.message ?? e}` })
    }
  }

  async function renameEntry(oldRel: string, newName: string) {
    const wd = workDir.value
    if (!wd) return
    const parent = oldRel.includes('/') ? oldRel.slice(0, oldRel.lastIndexOf('/')) : ''
    const newRel = parent ? `${parent}/${newName}` : newName
    try {
      await FileRename(wd, oldRel, newRel)
      if (parent && expanded.value.has(parent)) await loadDir(parent)
      // 重命名打开的 tab
      openFiles.value = openFiles.value.map((o) => o.relPath === oldRel ? { ...o, relPath: newRel } : o)
      if (activeRelPath.value === oldRel) activeRelPath.value = newRel
      // 迁移未保存草稿到新 relPath，避免重命名后编辑器丢失未保存内容
      if (oldRel in drafts.value) {
        const next = { ...drafts.value }
        next[newRel] = next[oldRel]
        delete next[oldRel]
        drafts.value = next
      }
    } catch (e: any) {
      // 管理操作失败由 store 负责提示，调用方无需处理
      pushToast({ level: 'error', source: 'file', message: `重命名失败：${e?.message ?? e}` })
    }
  }

  async function deleteEntry(relPath: string) {
    const wd = workDir.value
    if (!wd) return
    if (!window.confirm(`确定删除「${relPath}」？此操作不可撤销。`)) return
    try {
      await FileDelete(wd, relPath)
      const parent = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
      if (parent && expanded.value.has(parent)) await loadDir(parent)
      if (parent === '') await loadDir('')
      // 关闭被删文件的 tab
      openFiles.value = openFiles.value.filter((o) => o.relPath !== relPath)
      clearDraft(relPath)
      if (activeRelPath.value === relPath) {
        activeRelPath.value = openFiles.value[openFiles.value.length - 1]?.relPath ?? null
      }
    } catch (e: any) {
      // 管理操作失败由 store 负责提示，调用方无需处理
      pushToast({ level: 'error', source: 'file', message: `删除失败：${e?.message ?? e}` })
    }
  }

  // 外部变更：局部刷新树 + 处理打开文件的冲突
  let fileChangedCleanup: (() => void) | null = null
  function initWatcher() {
    fileChangedCleanup?.()
    fileChangedCleanup = FileChanged((e: { workDir: string; relPath: string }) => {
      if (e.workDir !== workDir.value) return
      const parts = e.relPath.split('/')
      const parent = parts.slice(0, -1).join('/')
      if (expanded.value.has(parent)) void loadDir(parent).catch(() => {})
      const f = openFiles.value.find((o) => o.relPath === e.relPath)
      if (f && !f.dirty) void reloadFile(e.relPath).catch(() => {})
      else if (f && f.dirty) f.externalChanged = true
    })
  }
  initWatcher()

  return {
    workDir, tree, expanded, openFiles, drafts, activeRelPath, collapsed, rootCreateRequest,
    setSession, loadDir, toggleExpand, openFile, closeFile, saveFile, reloadFile,
    setDraft, clearDraft,
    createEntry, renameEntry, deleteEntry,
    cleanupWatcher: () => { fileChangedCleanup?.(); fileChangedCleanup = null },
  }
})
