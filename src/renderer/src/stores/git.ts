import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  GitStatus,
  GitStage,
  GitUnstage,
  GitDiscard,
  GitCommit,
  GitRemoteOp,
  GitWatch,
  GitUnwatch,
  GitChanged,
  type GitStatusResult,
} from '../composables/useElectron'
import { pushToast } from '../composables/useToast'

export const useGitStore = defineStore('git', () => {
  const workDir = ref('')
  const status = ref<GitStatusResult | null>(null)
  const loading = ref(false)
  const error = ref('')
  /** 正在执行的远程/提交操作名，用于禁用按钮防重复触发 */
  const busyOp = ref<string | null>(null)

  const totalChanges = computed(() => {
    const s = status.value
    if (!s) return 0
    return s.staged.length + s.unstaged.length + s.untracked.length + s.conflicted.length
  })
  const hasStaged = computed(() => (status.value?.staged.length ?? 0) > 0)

  async function refresh(): Promise<void> {
    const wd = workDir.value
    if (!wd) {
      status.value = null
      return
    }
    loading.value = true
    try {
      const res = await GitStatus(wd)
      // 切换会话期间可能已经换了 workDir，丢弃过期结果
      if (workDir.value !== wd) return
      if (res.ok) {
        status.value = res.data
        error.value = ''
      } else {
        // 保持上一次的 status，把错误显示在面板里
        error.value = res.error
      }
    } catch (e: any) {
      error.value = e?.message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  /** 切换会话：换目录、重挂 watcher、刷新一次 */
  async function setSession(wd: string): Promise<void> {
    if (workDir.value === wd) return
    const prev = workDir.value
    workDir.value = wd
    status.value = null
    error.value = ''
    if (prev) await GitUnwatch(prev).catch(() => {})
    if (!wd) return
    await GitWatch(wd).catch(() => {})
    await refresh()
  }

  /** 统一包装「执行一次写操作 + 刷新 + 失败提示」 */
  async function withOp(name: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    // 任何写操作进行中都不允许再发起另一个（防连点重复提交）
    if (busyOp.value) return
    busyOp.value = name
    try {
      const res = await fn()
      if (!res.ok) {
        pushToast({ level: 'error', source: 'git', message: res.error ?? `${name} 失败` })
        return
      }
      await refresh()
    } catch (e: any) {
      pushToast({ level: 'error', source: 'git', message: e?.message ?? String(e) })
    } finally {
      busyOp.value = null
    }
  }

  const stage = (paths: string[]) => withOp('暂存', () => GitStage(workDir.value, paths))
  const unstage = (paths: string[]) => withOp('取消暂存', () => GitUnstage(workDir.value, paths))
  const discard = (paths: string[]) => withOp('丢弃', () => GitDiscard(workDir.value, paths))

  const commit = (message: string) =>
    withOp('提交', async () => {
      const res = await GitCommit(workDir.value, message)
      if (!res.ok) return res
      pushToast({ level: 'info', source: 'git', message: '提交成功' })
      return res
    })

  const runRemoteOp = (op: 'fetch' | 'pull' | 'push') =>
    withOp(op, async () => {
      const res = await GitRemoteOp(workDir.value, op)
      if (!res.ok) return res
      pushToast({ level: 'info', source: 'git', message: res.summary })
      return res
    })

  // git 内部状态变化（提交、外部 checkout 等）→ 自动刷新
  // 这里有意不保存 GitChanged 返回的退订函数：Pinia setup store 在应用生命周期内
  // 是单例、只创建一次，不存在多次订阅导致的重复回调或泄漏。
  GitChanged((wd: string) => {
    if (wd === workDir.value) void refresh()
  })

  return {
    workDir, status, loading, error, busyOp,
    totalChanges, hasStaged,
    setSession, refresh, stage, unstage, discard, commit, runRemoteOp,
  }
})
