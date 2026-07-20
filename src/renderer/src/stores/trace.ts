// trace Pinia store: trace 面板的状态管理
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  ListTraceRequests,
  GetSessionTraceStats,
  GetTraceRequest,
  DiffTraceRequests,
  GetUsageSummary,
  ListHappyEnvelopes,
  ExportTraceRequest,
} from '../composables/useElectron'

export interface TraceSummary {
  id: string
  seq: number
  ts: number
  startedAt: number
  firstByteAt: number | null
  finishedAt: number
  model: string | null
  status: number
  latencyMs: number | null
  format: string
  error: boolean
  cost: { usd: number; input: number; output: number }
  trace: { totalMs: number; ttftMs: number; genMs: number; inTps: number | null; outTps: number | null }
}

export interface SessionStats {
  sessionCount: number
  requestCount: number
  unmeasured: number
  totals: { input: number; output: number; cacheRead: number; cacheWrite: number; totalInput: number; cacheHitRate: number; usd: number }
}

export const useTraceStore = defineStore('trace', () => {
  const workDir = ref<string>('')
  const sessionId = ref<string>('')
  const requests = ref<TraceSummary[]>([])
  const stats = ref<SessionStats | null>(null)
  const modelFilter = ref<string>('all')
  const errorsOnly = ref<boolean>(false)
  const selectedSeq = ref<number | null>(null)
  const detail = ref<any | null>(null)
  const envelopes = ref<any[]>([])
  const diffResult = ref<any | null>(null)
  const usage = ref<any | null>(null)
  const picks = ref<number[]>([])
  const loading = ref<boolean>(false)

  const filteredRequests = computed(() => {
    let list = requests.value;
    if (modelFilter.value !== 'all') {
      list = list.filter((r) => r.model === modelFilter.value)
    }
    if (errorsOnly.value) {
      list = list.filter((r) => r.error || r.status >= 400)
    }
    return list
  })

  const availableModels = computed(() => {
    const set = new Set<string>()
    for (const r of requests.value) {
      if (r.model) set.add(r.model)
    }
    return Array.from(set).sort()
  })

  function setSession(wd: string, sid: string) {
    workDir.value = wd
    sessionId.value = sid
    selectedSeq.value = null
    detail.value = null
    picks.value = []
  }

  async function load() {
    if (!workDir.value || !sessionId.value) return
    loading.value = true
    try {
      const [reqs, s, envs] = await Promise.all([
        ListTraceRequests(workDir.value, sessionId.value, modelFilter.value),
        GetSessionTraceStats(workDir.value, sessionId.value, modelFilter.value),
        ListHappyEnvelopes(workDir.value, sessionId.value),
      ])
      requests.value = reqs
      stats.value = s
      envelopes.value = envs
    } finally {
      loading.value = false
    }
  }

  async function select(seq: number) {
    selectedSeq.value = seq
    detail.value = null
    if (workDir.value && sessionId.value) {
      detail.value = await GetTraceRequest(workDir.value, sessionId.value, seq)
    }
  }

  async function loadUsage() {
    usage.value = await GetUsageSummary()
  }

  async function diff(seqA: number, seqB: number) {
    if (!workDir.value || !sessionId.value) return
    diffResult.value = await DiffTraceRequests(workDir.value, sessionId.value, seqA, seqB)
  }

  function togglePick(seq: number) {
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
    workDir, sessionId, requests, stats, modelFilter, errorsOnly, selectedSeq, detail,
    envelopes, diffResult, usage, picks, loading,
    filteredRequests, availableModels,
    setSession, load, select, loadUsage, diff, togglePick, exportRequest,
  }
})
