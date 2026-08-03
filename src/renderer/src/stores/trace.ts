// trace Pinia store: trace 面板的状态管理（v2 分页 + 摘要索引）
import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import {
  ListTraceRequests,
  GetTraceRequest,
  DiffTraceRequests,
  ExportTraceRequest,
  WatchTraceSession,
  UnwatchTraceSession,
  EventsOn,
} from '../composables/useElectron'

export interface TraceSummary {
  seq: number
  ts: number
  model: string | null
  status: number
  latencyMs: number | null
  error: boolean
  cost: { usd: number; input: number; output: number }
  trace: { totalMs: number; ttftMs: number; genMs: number }
  toolCount: number
}

const PAGE_SIZE = 50

export const useTraceStore = defineStore('trace', () => {
  const workDir = ref<string>('')
  const sessionId = ref<string>('')
  const requests = ref<TraceSummary[]>([])
  const modelFilter = ref<string>('all')
  const errorsOnly = ref<boolean>(false)
  const selectedSeq = ref<number | null>(null)
  const detail = shallowRef<any | null>(null)
  const diffResult = ref<any | null>(null)
  const picks = ref<number[]>([])
  const loading = ref<boolean>(false)
  const loadError = ref<string | null>(null)
  const hasMore = ref<boolean>(false)
  const diffMode = ref<boolean>(false)

  const filteredRequests = computed(() => {
    let list = requests.value
    if (modelFilter.value !== 'all') {
      list = list.filter((r) => r.model === modelFilter.value)
    }
    if (errorsOnly.value) {
      list = list.filter((r) => r.error || r.status >= 400)
    }
    return list
  })

  const errorCount = computed(() => {
    return requests.value.filter((r) => r.error || r.status >= 400).length
  })

  const availableModels = computed(() => {
    const set = new Set<string>()
    for (const r of requests.value) {
      if (r.model) set.add(r.model)
    }
    return Array.from(set).sort()
  })

  // 当前最大 seq，用于增量加载
  const maxSeq = computed(() => {
    if (!requests.value.length) return 0
    return Math.max(...requests.value.map((r) => r.seq))
  })

  function setSession(wd: string, sid: string) {
    if (workDir.value && sessionId.value) {
      UnwatchTraceSession(workDir.value, sessionId.value).catch(() => {})
    }
    workDir.value = wd
    sessionId.value = sid
    selectedSeq.value = null
    detail.value = null
    picks.value = []
    requests.value = []
    hasMore.value = false
    if (wd && sid) {
      WatchTraceSession(wd, sid).catch(() => {})
    }
  }

  // 监听文件变更自动刷新（200ms 节流 + 防重入）
  let watchCleanup: (() => void) | null = null
  let loadPending = false
  let loadThrottle: ReturnType<typeof setTimeout> | null = null
  function initWatcher() {
    watchCleanup?.()
    watchCleanup = EventsOn('trace:updated', (wd: string, sid: string) => {
      if (wd === workDir.value && sid === sessionId.value) {
        scheduleLoad()
      }
    })
  }
  initWatcher()

  function scheduleLoad() {
    if (loadThrottle) return
    loadThrottle = setTimeout(() => {
      loadThrottle = null
      fetchNew()
    }, 200)
  }

  // 初始加载 / 过滤变化时全量刷新首页
  async function load() {
    if (!workDir.value || !sessionId.value) return
    loading.value = true
    loadError.value = null
    try {
      const opts: any = { limit: PAGE_SIZE, offset: 0 }
      if (modelFilter.value !== 'all') opts.modelFilter = modelFilter.value
      if (errorsOnly.value) opts.errorsOnly = true
      const r = await ListTraceRequests(workDir.value, sessionId.value, opts)
      requests.value = r.summaries
      hasMore.value = r.hasMore
    } catch (e: any) {
      loadError.value = e?.message || '加载失败'
    } finally {
      loading.value = false
    }
  }

  // 加载更多（滚动分页）
  async function loadMore() {
    if (!workDir.value || !sessionId.value || loading.value || !hasMore.value) return
    loading.value = true
    try {
      const opts: any = { limit: PAGE_SIZE, offset: requests.value.length }
      if (modelFilter.value !== 'all') opts.modelFilter = modelFilter.value
      if (errorsOnly.value) opts.errorsOnly = true
      const r = await ListTraceRequests(workDir.value, sessionId.value, opts)
      requests.value = [...requests.value, ...r.summaries]
      hasMore.value = r.hasMore
    } catch (e: any) {
      loadError.value = e?.message || '加载失败'
    } finally {
      loading.value = false
    }
  }

  // 增量加载新条目（文件变更触发）
  async function fetchNew() {
    if (!workDir.value || !sessionId.value) return
    if (loading.value) {
      loadPending = true
      return
    }
    loadPending = false
    loading.value = true
    try {
      const r = await ListTraceRequests(workDir.value, sessionId.value, { sinceSeq: maxSeq.value })
      if (r.summaries.length > 0) {
        requests.value = [...requests.value, ...r.summaries]
      }
      loadError.value = null
    } catch (e: any) {
      loadError.value = e?.message || '加载失败'
    } finally {
      loading.value = false
      if (loadPending) {
        loadPending = false
        fetchNew()
      }
    }
  }

  async function select(seq: number) {
    selectedSeq.value = seq
    detail.value = null
    if (workDir.value && sessionId.value) {
      detail.value = await GetTraceRequest(workDir.value, sessionId.value, seq)
    }
  }

  async function diff(seqA: number, seqB: number) {
    if (!workDir.value || !sessionId.value) return
    diffResult.value = await DiffTraceRequests(workDir.value, sessionId.value, seqA, seqB)
  }

  function toggleDiff() {
    diffMode.value = !diffMode.value
    picks.value = []
    diffResult.value = null
  }

  function togglePick(seq: number) {
    if (!diffMode.value) return
    if (picks.value.includes(seq)) {
      picks.value = picks.value.filter((x) => x !== seq)
    } else {
      picks.value = [...picks.value, seq].slice(-2)
      if (picks.value.length === 2) {
        diff(picks.value[0], picks.value[1])
      }
    }
  }

  async function exportRequest(seq: number, format: 'raw' | 'md' | 'json' | 'har') {
    if (!workDir.value || !sessionId.value) return null
    return await ExportTraceRequest(workDir.value, sessionId.value, seq, format)
  }

  return {
    workDir, sessionId, requests, modelFilter, errorsOnly, selectedSeq, detail,
    diffResult, picks, loading, diffMode, loadError, hasMore,
    filteredRequests, availableModels, errorCount, maxSeq,
    setSession, load, loadMore, select, diff, toggleDiff, togglePick, exportRequest,
    cleanupWatcher: () => { watchCleanup?.(); watchCleanup = null },
  }
})
