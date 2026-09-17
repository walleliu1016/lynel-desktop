import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  GitStatus,
  GitStage,
  GitUnstage,
  GitDiscard,
  GitCommit,
  GitRemoteOp,
  GitLogGraph,
  GitCommitDetail,
  GitBranchList,
  GitBranchCreate,
  GitBranchCheckout,
  GitBranchDelete,
  GitStashList,
  GitStashPush,
  GitStashPop,
  GitStashDrop,
  GitResetTo,
  GitWatch,
  GitUnwatch,
  GitChanged,
  type GitBranchInfo,
  type GitCommitInfo,
  type GitGraphCommit,
  type GitStashEntry,
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
  /** 提交历史图（`git log --graph` 的解析结果，最新提交在前） */
  const log = ref<GitGraphCommit[]>([])
  const logLoading = ref(false)
  /** 当前在历史列表里展开的提交（'' = 没有展开）+ 它的文件列表详情 */
  const expandedHash = ref('')
  const commitDetail = ref<GitCommitInfo | null>(null)
  const detailLoading = ref(false)
  /** 本地分支列表（分支下拉里展示与切换） */
  const branches = ref<GitBranchInfo[]>([])
  /** stash 列表，最新在前 */
  const stashes = ref<GitStashEntry[]>([])

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

  // loadLog 的 in-flight 序号：与 refresh 同理，切目录 / 连点刷新时只认最后一次结果
  let logSeq = 0

  /** 拉取提交历史图。失败不弹 toast：非仓库、空仓库（尚无 commit）都是正常的用户状态，
   *  面板自行显示空态即可，不该用错误提示打断上方的变更列表。 */
  async function loadLog(): Promise<void> {
    const wd = workDir.value
    if (!wd) {
      log.value = []
      return
    }
    const token = ++logSeq
    logLoading.value = true
    try {
      const res = await GitLogGraph(wd)
      // 序号与目录双重比对：序号挡住更晚发起的调用，目录挡住已切走的会话
      if (token !== logSeq || workDir.value !== wd) return
      if (res.ok) log.value = res.data
    } catch {
      // 静默：异常时保留上一次的历史，下一轮 watcher 触发会再试
    } finally {
      if (token === logSeq) logLoading.value = false
    }
  }

  // branches / stashes 的 in-flight 序号，作用同 refresh 与 loadLog
  let branchSeq = 0
  let stashSeq = 0

  /** 拉取本地分支列表。失败静默：分支列表不可用不该影响变更列表的展示。 */
  async function loadBranches(): Promise<void> {
    const wd = workDir.value
    if (!wd) {
      branches.value = []
      return
    }
    const token = ++branchSeq
    try {
      const res = await GitBranchList(wd)
      if (token !== branchSeq || workDir.value !== wd) return
      if (res.ok) branches.value = res.data
    } catch {
      // 静默，保留上一次结果
    }
  }

  /** 拉取 stash 列表。 */
  async function loadStashes(): Promise<void> {
    const wd = workDir.value
    if (!wd) {
      stashes.value = []
      return
    }
    const token = ++stashSeq
    try {
      const res = await GitStashList(wd)
      if (token !== stashSeq || workDir.value !== wd) return
      if (res.ok) stashes.value = res.data
    } catch {
      // 静默，保留上一次结果
    }
  }

  /** 刷新面板的全部数据：变更状态 + 提交历史图 + 分支 + stash。
   *  它们由同一批 .git 变化驱动（提交 / checkout / 切分支 / stash），
   *  合并成一个入口，任何一处改动都不会漏刷。 */
  async function refreshAll(): Promise<void> {
    await Promise.all([refresh(), loadLog(), loadBranches(), loadStashes()])
  }

  // detailSeq：连点不同提交时，只有最后一次发起的详情才作数
  let detailSeq = 0

  /** 展开 / 收起某个提交的文件列表。再次点击同一个提交即收起。 */
  async function toggleCommitDetail(hash: string): Promise<void> {
    if (expandedHash.value === hash) {
      expandedHash.value = ''
      commitDetail.value = null
      return
    }
    const wd = workDir.value
    if (!wd) return
    expandedHash.value = hash
    // 先清空：否则新提交的文件列表会有一瞬间显示的是上一个提交的内容
    commitDetail.value = null
    const token = ++detailSeq
    detailLoading.value = true
    try {
      const res = await GitCommitDetail(wd, hash)
      if (token !== detailSeq || workDir.value !== wd) return
      if (res.ok) commitDetail.value = res.data
      else pushToast({ level: 'error', source: 'git', message: res.error })
    } catch (e: any) {
      if (token !== detailSeq) return
      pushToast({ level: 'error', source: 'git', message: e?.message ?? String(e) })
    } finally {
      if (token === detailSeq) detailLoading.value = false
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
    // 历史图 / 展开的提交详情 / 分支 / stash 同样要清掉：
    // 否则切会话的瞬间会先显示上一个仓库的内容
    log.value = []
    expandedHash.value = ''
    commitDetail.value = null
    branches.value = []
    stashes.value = []
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
    if (seq === sessionSeq) await refreshAll()
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
      await refreshAll()
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

  // —— 分支 ——
  const createBranch = (name: string) =>
    withOp('新建分支', async () => {
      const res = await GitBranchCreate(workDir.value, name)
      if (res.ok) pushToast({ level: 'info', source: 'git', message: `已新建并切换到 ${name}` })
      return res
    })

  const checkoutBranch = (name: string) =>
    withOp('切换分支', async () => {
      const res = await GitBranchCheckout(workDir.value, name)
      if (res.ok) pushToast({ level: 'info', source: 'git', message: `已切换到 ${name}` })
      return res
    })

  const deleteBranch = (name: string, force = false) =>
    withOp('删除分支', () => GitBranchDelete(workDir.value, name, force))

  /** 重置当前分支到某个提交。hard 模式不可逆，二次确认由调用方负责。 */
  const resetTo = (hash: string, mode: 'soft' | 'mixed' | 'hard') =>
    withOp('重置', () => GitResetTo(workDir.value, hash, mode))

  // —— stash ——
  const stashChanges = (message?: string) =>
    withOp('暂存改动', () => GitStashPush(workDir.value, message))

  const popStash = (index: number) =>
    withOp('取出暂存', () => GitStashPop(workDir.value, index))

  const dropStash = (index: number) =>
    withOp('丢弃暂存', () => GitStashDrop(workDir.value, index))

  // git 内部状态变化（提交、外部 checkout 等）→ 自动刷新
  // 这里有意不保存 GitChanged 返回的退订函数：Pinia setup store 在应用生命周期内
  // 是单例、只创建一次，不存在多次订阅导致的重复回调或泄漏。
  GitChanged((wd: string) => {
    if (wd === workDir.value) void refreshAll()
  })

  return {
    workDir, status, loading, error, busyOp,
    log, logLoading, expandedHash, commitDetail, detailLoading,
    branches, stashes,
    totalChanges, hasStaged,
    setSession, refresh, refreshAll, loadLog, toggleCommitDetail,
    stage, unstage, discard, commit, runRemoteOp,
    createBranch, checkoutBranch, deleteBranch, resetTo,
    stashChanges, popStash, dropStash,
  }
})
