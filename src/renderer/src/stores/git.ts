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

  // refresh 的 in-flight 序号：切换会话或快速连点刷新时，只有最后一次发起的结果才作数
  let refreshSeq = 0

  async function refresh(): Promise<void> {
    const wd = workDir.value
    if (!wd) {
      status.value = null
      error.value = ''
      return
    }
    const token = ++refreshSeq
    loading.value = true
    try {
      const res = await GitStatus(wd)
      // 序号：更晚发起的 refresh 存在时本结果作废
      // 目录：workDir 可能已被清空或切走（清空路径不会自增序号，故必须同时比对目录）
      if (token !== refreshSeq || workDir.value !== wd) return
      if (res.ok) {
        status.value = res.data
        error.value = ''
      } else {
        // 保持上一次的 status，把错误显示在面板里
        error.value = res.error
      }
    } catch (e: any) {
      // 即使走 reject 分支也要丢弃过期结果，否则错误文案会落到新会话上
      // 同样要同时比对序号与目录
      if (token !== refreshSeq || workDir.value !== wd) return
      error.value = e?.message ?? String(e)
    } finally {
      // 只有最后一次发起的 refresh 才复位 loading，否则会把新会话的加载态提前关掉
      if (token === refreshSeq) loading.value = false
    }
  }

  /** 当前已在主进程挂上 watcher 的目录。必须显式记录：setSession 是异步的，
   *  两次调用交错时 workDir 可能已被后来的调用改写，从它反推会漏卸载
   *  （A→B→C 交错下 B 的 watcher 会永远留在主进程的 Map 里）。 */
  let watchedDir = ''
  /** setSession 的调用序号。仅靠 watchedDir 不足以挡住交错：A→B→C 时 B 恢复后
   *  会看到 watchedDir 已是 C，于是「C !== B」成立又重新挂上 B，泄漏 C。
   *  用序号保证只有最后一次调用才有资格落 watcher。 */
  let sessionSeq = 0

  /** 切换会话：换目录、重挂 watcher、刷新一次 */
  async function setSession(wd: string): Promise<void> {
    if (workDir.value === wd) return
    const seq = ++sessionSeq
    workDir.value = wd
    status.value = null
    error.value = ''
    // 卸载「真正挂着的那一个」，而不是当前 workDir
    if (watchedDir && watchedDir !== wd) {
      const old = watchedDir
      watchedDir = ''
      await GitUnwatch(old).catch(() => {})
    }
    if (!wd) return
    // 本次已被更晚的调用取代：绝不再挂 watcher（否则挂上的是已离开的目录且永不回收）
    if (seq !== sessionSeq) return
    // 若已有别的调用抢先挂上了同一个目标目录，就不用重复挂
    if (watchedDir !== wd) {
      await GitWatch(wd).catch(() => {})
      watchedDir = wd
    }
    // 同一时刻只有一个会话是「当前」的，只有最新的那次刷新才有意义
    if (seq === sessionSeq) await refresh()
  }

  /** 统一包装「执行一次写操作 + 刷新 + 失败提示」 */
  async function withOp(name: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    // 任何写操作进行中都不允许再发起另一个（防连点重复提交）
    if (busyOp.value) return
    // 没有工作目录就没有仓库可操作。必须在这里拦住：主进程侧 empty baseDir 会被
    // simple-git 当作 falsy 而回退到 process.cwd()，那会把变更写进应用自己的仓库。
    if (!workDir.value) {
      pushToast({ level: 'error', source: 'git', message: '未选择会话，无法执行 Git 操作' })
      return
    }
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
