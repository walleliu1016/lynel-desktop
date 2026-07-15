<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, nextTick, watch } from 'vue'
import { sessionDisplayTitle } from '../stores/sessions'
import { EventsOn, ResolvePermission, SetNotchSize, ListSessions, GetSessionStates } from '../composables/useElectron'

interface PermissionReq {
  id: string
  sessionId: string
  workDir: string
  toolName: string
  toolInput: any
}

interface SessionMeta {
  id: string
  workdir: string
  project: string
  ai_title?: string
  first_prompt?: string
  msg_count: number
}

interface SessionActivity {
  phase: 'thinking' | 'working' | 'idle' | 'awaiting_permission'
  tool?: string
  toolInput?: string
}

interface AskOption {
  label: string
  description?: string
}

interface AskQuestion {
  header: string
  question: string
  multiSelect: boolean
  options: AskOption[]
}

const PILL_W = 240
const PILL_H = 34
const EXPAND_W = 380
const MAX_BODY_H = 420

const expanded = ref(false)
const pillCard = ref<HTMLElement | null>(null)
const pendingReq = ref<PermissionReq | null>(null)
const isActive = ref(false)
const sessionList = ref<SessionMeta[]>([])
const sessionStates = ref<Record<string, string>>({})
const sessionActivity = ref<Record<string, SessionActivity>>({})
const askQuestions = ref<AskQuestion[]>([])
const askAnswers = ref<Record<string, string | string[]>>({})
const customInputs = ref<Record<string, string>>({})
const activeQIndex = ref(0)
const showAllSessions = ref(false)
let collapseTimer: number | null = null
const cleanups: Array<() => void> = []

const isAsk = computed(() => pendingReq.value?.toolName === 'AskUserQuestion')
const questionCount = computed(() => askQuestions.value.length)

const activePhase = computed(() => {
  if (pendingReq.value && !isAsk.value) return 'awaiting_permission'
  const acts = Object.values(sessionActivity.value)
  if (acts.length === 0) return isActive.value ? 'thinking' : 'idle'
  if (acts.some(a => a.phase === 'working')) return 'working'
  if (acts.some(a => a.phase === 'thinking')) return 'thinking'
  return 'idle'
})

const crabColor = computed(() => {
  if (pendingReq.value && !isAsk.value) return '#F59E0B'
  if (activePhase.value === 'working' || activePhase.value === 'thinking') return '#F97316'
  return '#475569'
})

const crabGlow = computed(() => {
  if (pendingReq.value && !isAsk.value) return '0 0 6px rgba(245,158,11,0.3)'
  if (activePhase.value === 'working' || activePhase.value === 'thinking') return '0 0 6px rgba(249,115,22,0.3)'
  return 'none'
})

const headerText = computed(() => {
  if (pendingReq.value) {
    if (isAsk.value) return `问题 (${activeQIndex.value + 1}/${questionCount.value})`
    return `权限请求: ${pendingReq.value.toolName}`
  }
  const acts = Object.values(sessionActivity.value)
  const working = acts.find(a => a.phase === 'working')
  if (working) {
    const input = working.toolInput || ''
    const preview = input.length > 28 ? input.slice(0, 28) + '...' : input
    return preview || working.tool || '工作中'
  }
  if (acts.some(a => a.phase === 'thinking')) return '思考中'
  if (isActive.value) return '工作中'
  return 'Lynel'
})

const isProcessing = computed(() => activePhase.value !== 'idle')

const activeSessions = computed(() => sessionList.value.filter(s => sessionStates.value[s.id] === 'running'))
const inactiveSessions = computed(() => sessionList.value.filter(s => sessionStates.value[s.id] !== 'running'))

// ---- dynamic sizing ----
function syncSize() {
  if (!expanded.value) return
  nextTick(() => {
    const card = pillCard.value
    if (!card) return
    const h = Math.min(card.scrollHeight, MAX_BODY_H + PILL_H)
    SetNotchSize(EXPAND_W, h)
  })
}

watch([() => pendingReq.value, activeQIndex, showAllSessions], () => {
  syncSize()
})

// ---- hover ----
function cancelCollapse() {
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null }
}

function onMouseEnter() {
  cancelCollapse()
  if (!expanded.value) {
    expanded.value = true
    SetNotchSize(EXPAND_W, 360)
    nextTick(() => syncSize())
    fetchSessions()
  }
}

function onMouseLeave() {
  if (!expanded.value) return
  // 有待处理权限请求时不自动折叠，避免 IME 输入法选词等场景误触发
  if (pendingReq.value) return
  collapseTimer = window.setTimeout(() => {
    if (!pendingReq.value) {
      expanded.value = false
      SetNotchSize(PILL_W, PILL_H)
    }
    collapseTimer = null
  }, 400)
}

function onWindowBlur() {
  setTimeout(() => {
    if (!document.hasFocus() && !pendingReq.value) {
      expanded.value = false
      SetNotchSize(PILL_W, PILL_H)
    }
  }, 200)
}

async function fetchSessions() {
  try {
    sessionList.value = (await ListSessions()) as SessionMeta[]
    const states = await GetSessionStates()
    sessionStates.value = states as Record<string, string>
  } catch { sessionList.value = [] }
}

// ---- AskUserQuestion ----
function parseAskQuestions(input: any): AskQuestion[] {
  try {
    const qs = input?.questions
    if (!Array.isArray(qs)) return []
    return qs.map((q: any) => ({
      header: q.header || q.question || '',
      question: q.question || '',
      multiSelect: !!q.multiSelect,
      options: Array.isArray(q.options) ? q.options.map((o: any) => ({
        label: o.label || '',
        description: o.description,
      })) : [],
    }))
  } catch { return [] }
}

function selectQ(index: number) {
  activeQIndex.value = index
}

function toggleAnswer(questionText: string, label: string, multi: boolean) {
  if (multi) {
    const current = (askAnswers.value[questionText] as string[]) || []
    const idx = current.indexOf(label)
    if (idx >= 0) current.splice(idx, 1)
    else current.push(label)
    askAnswers.value = { ...askAnswers.value, [questionText]: [...current] }
  } else {
    askAnswers.value = { ...askAnswers.value, [questionText]: label }
    customInputs.value = { ...customInputs.value, [questionText]: '' }
  }
}

function isSelected(questionText: string, label: string): boolean {
  const v = askAnswers.value[questionText]
  if (!v) return false
  if (Array.isArray(v)) return v.includes(label)
  return v === label
}

function hasPresetSelection(q: AskQuestion): boolean {
  const v = askAnswers.value[q.question]
  if (!v) return false
  if (Array.isArray(v)) return v.length > 0
  return !!v
}

function setCustomAnswer(questionText: string, value: string, multi: boolean) {
  customInputs.value = { ...customInputs.value, [questionText]: value }
  if (!multi) {
    if (value) {
      askAnswers.value = { ...askAnswers.value, [questionText]: value }
    }
  }
}

function buildFinalAnswers(): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const q of askQuestions.value) {
    const custom = customInputs.value[q.question]
    const preset = askAnswers.value[q.question]
    if (q.multiSelect) {
      const merged: string[] = []
      if (Array.isArray(preset)) merged.push(...preset)
      if (custom) merged.push(custom)
      if (merged.length > 0) result[q.question] = merged
    } else {
      if (custom) result[q.question] = custom
      else if (preset) result[q.question] = preset
    }
  }
  return result
}

// ---- permission ----
function handleApprove() {
  if (!pendingReq.value) return
  const answers = isAsk.value ? buildFinalAnswers() : undefined
  ResolvePermission(pendingReq.value.id, 'allow', 'notch', answers)
  resetAsk()
}

function handleDeny() {
  if (!pendingReq.value) return
  ResolvePermission(pendingReq.value.id, 'deny', 'notch')
  resetAsk()
}

function resetAsk() {
  pendingReq.value = null
  askAnswers.value = {}
  askQuestions.value = []
  customInputs.value = {}
  activeQIndex.value = 0
}

function getCommandPreview(input: any): string {
  if (!input) return ''
  if (input.command) return String(input.command).slice(0, 120)
  if (input.file_path) return input.file_path
  return JSON.stringify(input).slice(0, 80)
}

function getPhaseClass(sid: string): string {
  const a = sessionActivity.value[sid]
  if (!a) return 'phase-idle'
  return `phase-${a.phase}`
}

function getPhaseLabel(sid: string): string {
  const a = sessionActivity.value[sid]
  if (!a) return ''
  if (a.phase === 'working') return a.tool || ''
  if (a.phase === 'thinking') return ''
  return ''
}

// ---- lifecycle ----
onMounted(() => {
  const style = document.createElement('style')
  style.textContent = `
    html, body {
      margin: 0; padding: 0; box-sizing: border-box;
      background: transparent !important;
      overflow: hidden;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
      -webkit-font-smoothing: antialiased;
      -webkit-app-region: no-drag;
      user-select: none;
    }
    ::-webkit-scrollbar { width: 3px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.15); border-radius: 2px; }
  `
  document.head.appendChild(style)

  window.addEventListener('blur', onWindowBlur)

  cleanups.push(EventsOn('sessions:state:changed', async (id: string, state: string) => {
    sessionStates.value = { ...sessionStates.value, [id]: state }
    isActive.value = Object.values(sessionStates.value).some(s => s === 'running')
  }))

  cleanups.push(EventsOn('sessions:list:changed', () => {
    fetchSessions()
  }))

  cleanups.push(EventsOn('sessions:activity', (payload: string) => {
    try {
      const data = JSON.parse(payload)
      sessionActivity.value = {
        ...sessionActivity.value,
        [data.sessionId]: {
          phase: data.phase,
          tool: data.tool,
          toolInput: data.toolInput,
        }
      }
    } catch {}
  }))

  cleanups.push(EventsOn('permission:request', (payload: string) => {
    try {
      const req = JSON.parse(payload) as PermissionReq
      pendingReq.value = req
      isActive.value = true
      if (req.toolName === 'AskUserQuestion') {
        askQuestions.value = parseAskQuestions(req.toolInput)
        activeQIndex.value = 0
      }
      cancelCollapse()
      if (!expanded.value) {
        expanded.value = true
        SetNotchSize(EXPAND_W, 360)
        nextTick(() => syncSize())
      }
      fetchSessions()
    } catch {}
  }))

  cleanups.push(EventsOn('permission:cancelled', (payload: string) => {
    try {
      const data = JSON.parse(payload)
      if (pendingReq.value && pendingReq.value.sessionId === data.sessionId) {
        resetAsk()
        collapseTimer = window.setTimeout(() => {
          expanded.value = false
          SetNotchSize(PILL_W, PILL_H)
          collapseTimer = null
        }, 400)
      }
    } catch {}
  }))
})

onBeforeUnmount(() => {
  cancelCollapse()
  cleanups.forEach(fn => fn())
  window.removeEventListener('blur', onWindowBlur)
})
</script>

<template>
  <div class="island-shell" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave">
    <div ref="pillCard" class="pill-card" :class="{ 'is-expanded': expanded }">
      <!-- header -->
      <div class="pill-header">
        <div class="header-left">
          <svg width="20" height="16" viewBox="0 0 66 52" class="crab-svg" :class="{ 'is-active': isProcessing }" :style="{ filter: crabGlow }">
            <!-- legs -->
            <g :fill="crabColor">
              <rect x="0" y="13" width="6" height="12" rx="2" class="leg leg-l1" />
              <rect x="60" y="13" width="6" height="12" rx="2" class="leg leg-r1" />
              <rect x="6" y="38" width="5" height="14" rx="2" class="leg leg-l2" />
              <rect x="18" y="38" width="5" height="14" rx="2" class="leg leg-l3" />
              <rect x="43" y="38" width="5" height="14" rx="2" class="leg leg-r2" />
              <rect x="55" y="38" width="5" height="14" rx="2" class="leg leg-r3" />
              <!-- body -->
              <rect x="5" y="0" width="56" height="39" rx="4" class="body" />
            </g>
            <!-- eyes -->
            <rect x="11" y="13" width="7" height="7" rx="2" fill="#0A0F1A" />
            <rect x="48" y="13" width="7" height="7" rx="2" fill="#0A0F1A" />
          </svg>
        </div>

        <div class="header-center">
          <span class="header-title">{{ headerText }}</span>
        </div>

        <div class="header-right">
          <span class="status-ring" :class="activePhase" />
        </div>
      </div>

      <!-- body -->
      <div v-if="expanded" class="pill-body">
        <!-- AskUserQuestion -->
        <div v-if="isAsk && askQuestions.length" class="ask-card" @click.stop>
          <div v-if="questionCount > 1" class="ask-tabs">
            <button
              v-for="(q, qi) in askQuestions"
              :key="qi"
              class="ask-tab"
              :class="{ active: activeQIndex === qi, done: hasPresetSelection(q) }"
              @click="selectQ(qi)"
            >
              {{ qi + 1 }}
            </button>
          </div>

          <div class="ask-block">
            <div class="ask-header">{{ askQuestions[activeQIndex].header }}</div>
            <div class="ask-q">{{ askQuestions[activeQIndex].question }}</div>

            <div class="ask-options">
              <label
                v-for="opt in askQuestions[activeQIndex].options"
                :key="opt.label"
                class="ask-opt"
                :class="{ selected: isSelected(askQuestions[activeQIndex].question, opt.label) }"
                @click="toggleAnswer(askQuestions[activeQIndex].question, opt.label, askQuestions[activeQIndex].multiSelect)"
              >
                <span v-if="askQuestions[activeQIndex].multiSelect" class="ask-check" :class="{ on: isSelected(askQuestions[activeQIndex].question, opt.label) }" />
                <span v-else class="ask-radio" :class="{ on: isSelected(askQuestions[activeQIndex].question, opt.label) }" />
                <span class="ask-label">{{ opt.label }}</span>
                <span v-if="opt.description" class="ask-desc">{{ opt.description }}</span>
              </label>
            </div>

            <div class="ask-custom">
              <input
                class="custom-input"
                :value="customInputs[askQuestions[activeQIndex].question] || ''"
                @input="setCustomAnswer(askQuestions[activeQIndex].question, ($event.target as HTMLInputElement).value, askQuestions[activeQIndex].multiSelect)"
                placeholder="或输入自定义内容..."
              />
            </div>
          </div>

          <div class="ask-btns">
            <button class="btn-deny" @click="handleDeny">跳过</button>
            <button class="btn-allow" @click="handleApprove">提交</button>
          </div>
        </div>

        <!-- 权限卡片 -->
        <div v-else-if="pendingReq" class="perm-card" @click.stop>
          <div class="perm-tool-badge">{{ pendingReq.toolName }}</div>
          <div class="cmd-preview">{{ getCommandPreview(pendingReq.toolInput) }}</div>
          <div class="perm-btns">
            <button class="btn-deny" @click="handleDeny">拒绝</button>
            <button class="btn-allow" @click="handleApprove">允许</button>
          </div>
        </div>

        <!-- 运行中会话 -->
        <div v-if="activeSessions.length" class="section-label">运行中</div>
        <div v-if="activeSessions.length" class="session-list" @click.stop>
          <div
            v-for="s in activeSessions"
            :key="s.id"
            class="session-row"
            :class="getPhaseClass(s.id)"
          >
            <span class="sess-dot" :class="getPhaseClass(s.id)" />
            <span class="sess-name">{{ sessionDisplayTitle(s) }}</span>
            <span v-if="getPhaseLabel(s.id)" class="sess-phase">{{ getPhaseLabel(s.id) }}</span>
            <span class="sess-meta">{{ s.msg_count }} msgs</span>
          </div>
        </div>

        <!-- 非运行中会话：折叠 -->
        <div v-if="inactiveSessions.length" class="fold-section" @click.stop>
          <div class="fold-toggle" @click="showAllSessions = !showAllSessions">
            <svg width="10" height="10" viewBox="0 0 10 10" class="fold-chevron" :class="{ open: showAllSessions }">
              <path d="M3 1 L7 5 L3 9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="fold-label">其他会话</span>
            <span class="fold-badge">{{ inactiveSessions.length }}</span>
          </div>
          <div v-if="showAllSessions" class="session-list fold-list">
            <div
              v-for="s in inactiveSessions"
              :key="s.id"
              class="session-row phase-idle"
            >
              <span class="sess-dot phase-idle" />
              <span class="sess-name">{{ sessionDisplayTitle(s) }}</span>
              <span class="sess-meta">{{ s.msg_count }} msgs</span>
            </div>
          </div>
        </div>

        <div v-if="!sessionList.length && !pendingReq" class="empty-hint" @click.stop>暂无会话</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ---- tokens (on .island-shell, not :root — scoped styles don't reach :root) ---- */
.island-shell {
  --bg-pill: #0A0F1A;
  --bg-card: rgba(148,163,184,0.04);
  --bg-card-hover: rgba(148,163,184,0.10);
  --bg-card-active: rgba(148,163,184,0.06);
  --surface: rgba(148,163,184,0.06);
  --surface-hover: rgba(148,163,184,0.10);
  --border: rgba(148,163,184,0.08);
  --border-active: rgba(148,163,184,0.16);
  --border-card: rgba(148,163,184,0.06);
  --text-primary: #F1F5F9;
  --text-secondary: #94A3B8;
  --text-muted: #64748B;
  --accent: #22C55E;
  --danger: #EF4444;
  --warning: #F59E0B;
  --working: #F97316;
  --thinking: #F97316;

  position: fixed;
  top: 0; left: 50%;
  transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center;
  pointer-events: auto;
}

/* ---- pill card ---- */
.pill-card {
  background: var(--bg-pill);
  width: 240px;
  min-height: 34px;
  border-radius: 0 0 16px 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
  border-bottom: 1px solid transparent;
  transition: width 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              min-height 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              border-radius 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.45s ease;
}

.pill-card.is-expanded {
  width: 380px;
  border-radius: 0 0 22px 22px;
  border-bottom-color: var(--border-active);
  box-shadow: 0 0 0 1px rgba(148,163,184,0.08), 0 16px 48px rgba(0,0,0,0.6);
}

/* ---- header ---- */
.pill-header {
  display: flex; align-items: center;
  height: 34px; padding: 0 12px;
  flex-shrink: 0;
  gap: 8px;
}
.header-left  { width: 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.header-right { width: 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; }
.header-center {
  flex: 1; display: flex; align-items: center; justify-content: center;
  overflow: hidden; min-width: 0;
}
.header-title {
  font-size: 11px; font-weight: 500; color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  letter-spacing: 0.01em;
}
.crab-svg { flex-shrink: 0; transition: filter 0.5s ease; }

/* ---- crab leg animation ---- */
.crab-svg.is-active .leg {
  animation: leg-wave 0.7s ease-in-out infinite;
}
.crab-svg.is-active .leg-l1 { animation-delay: 0s; }
.crab-svg.is-active .leg-r1 { animation-delay: 0.12s; }
.crab-svg.is-active .leg-l2 { animation-delay: 0.24s; }
.crab-svg.is-active .leg-r2 { animation-delay: 0.36s; }
.crab-svg.is-active .leg-l3 { animation-delay: 0.18s; }
.crab-svg.is-active .leg-r3 { animation-delay: 0.3s; }

@keyframes leg-wave {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-2.5px); }
}

/* ---- status ring ---- */
.status-ring {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  transition: background 0.5s ease, box-shadow 0.5s ease;
}
.status-ring.idle                 { background: var(--text-muted); }
.status-ring.thinking             { background: var(--thinking); box-shadow: 0 0 6px rgba(249,115,22,0.4); }
.status-ring.working              { background: var(--working); box-shadow: 0 0 6px rgba(249,115,22,0.4); animation: pulse-ring 1.4s ease-in-out infinite; }
.status-ring.awaiting_permission  { background: var(--warning); box-shadow: 0 0 8px rgba(245,158,11,0.5); animation: pulse-ring 0.8s ease-in-out infinite; }

@keyframes pulse-ring {
  0%,100% { transform: scale(1); opacity: 1; }
  50%     { transform: scale(1.3); opacity: 0.6; }
}

/* ---- body ---- */
.pill-body {
  padding: 6px 14px 14px;
  display: flex; flex-direction: column; gap: 8px;
  max-height: 420px; overflow-y: auto;
  animation: fadeDown 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes fadeDown {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ---- section label ---- */
.section-label {
  font-size: 10px; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.06em;
  padding: 2px 4px 0;
}

/* ---- ask tabs ---- */
.ask-tabs {
  display: flex; gap: 6px; justify-content: center;
}
.ask-tab {
  width: 26px; height: 26px; border-radius: 50%;
  border: 1.5px solid var(--border); background: transparent;
  color: var(--text-muted); font-size: 11px; font-weight: 600;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.2s ease;
}
.ask-tab:hover { border-color: var(--text-muted); }
.ask-tab.active {
  border-color: var(--accent); color: var(--accent);
  background: rgba(34,197,94,0.08);
}
.ask-tab.done {
  border-color: var(--accent); color: var(--accent);
  background: rgba(34,197,94,0.04);
}

/* ---- ask card ---- */
.ask-card {
  display: flex; flex-direction: column; gap: 6px;
}
.ask-block {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px; padding: 8px 12px;
}
.ask-header {
  font-size: 9px; font-weight: 600; color: var(--text-muted);
  margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.06em;
}
.ask-q {
  font-size: 13px; font-weight: 500; color: var(--text-primary);
  margin-bottom: 6px; line-height: 1.4;
}
.ask-options {
  display: flex; flex-direction: column; gap: 1px;
  max-height: 220px; overflow-y: auto;
}
.ask-opt {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 8px; border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.ask-opt:hover { background: var(--surface-hover); }
.ask-opt.selected { background: rgba(34,197,94,0.08); }

.ask-radio, .ask-check {
  width: 14px; height: 14px; flex-shrink: 0;
  border: 1.5px solid var(--border-active);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s ease;
}
.ask-radio { border-radius: 50%; }
.ask-check { border-radius: 3px; }
.ask-radio.on, .ask-check.on {
  border-color: var(--accent); background: rgba(34,197,94,0.2);
}
.ask-radio.on::after {
  content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--accent);
}
.ask-check.on::after {
  content: ''; width: 8px; height: 8px;
  background: var(--accent);
  clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 40% 60%);
}

.ask-label { font-size: 12px; color: var(--text-primary); }
.ask-desc { font-size: 10px; color: var(--text-muted); margin-left: auto; white-space: nowrap; }

/* ---- custom input ---- */
.ask-custom { margin-top: 6px; }
.custom-input {
  width: 100%; box-sizing: border-box;
  padding: 6px 10px; border-radius: 6px;
  background: rgba(148,163,184,0.04); border: 1px solid var(--border);
  color: var(--text-primary); font-size: 12px; font-family: inherit;
  outline: none; transition: border-color 0.2s ease;
}
.custom-input::placeholder { color: var(--text-muted); }
.custom-input:focus { border-color: var(--accent); }

/* ---- buttons ---- */
.ask-btns, .perm-btns {
  display: flex; gap: 8px;
}
.ask-btns button, .perm-btns button {
  flex: 1; padding: 7px 0; border: none; border-radius: 8px;
  font-size: 12px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all 0.2s ease;
}
.btn-deny { background: rgba(239,68,68,0.12); color: var(--danger); }
.btn-deny:hover { background: rgba(239,68,68,0.22); }
.btn-allow { background: rgba(34,197,94,0.12); color: var(--accent); }
.btn-allow:hover { background: rgba(34,197,94,0.22); }

/* ---- permission card ---- */
.perm-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 12px;
}
.perm-tool-badge {
  display: inline-block; font-size: 10px; font-weight: 600;
  color: var(--warning); background: rgba(245,158,11,0.1);
  padding: 2px 8px; border-radius: 4px; margin-bottom: 8px;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.cmd-preview {
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
  font-size: 11px; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-bottom: 10px; line-height: 1.4;
}

/* ==============================================
   session list — redesigned
   ============================================== */
.session-list {
  display: flex; flex-direction: column; gap: 2px;
}

.session-row {
  position: relative;
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease,
              transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.2s ease;
  /* left accent strip (hidden until hover) */
  --strip-color: transparent;
}
.session-row::before {
  content: '';
  position: absolute; left: 0; top: 6px; bottom: 6px;
  width: 3px; border-radius: 0 3px 3px 0;
  background: var(--strip-color);
  transition: background 0.2s ease, opacity 0.2s ease;
  opacity: 0;
}
.session-row:hover {
  background: var(--bg-card-hover);
  transform: translateX(2px);
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}
.session-row:hover::before {
  opacity: 1;
}

/* accent strip color per phase (on row level) */
.session-row.phase-working             { --strip-color: var(--working); }
.session-row.phase-thinking            { --strip-color: var(--thinking); }
.session-row.phase-awaiting_permission { --strip-color: var(--warning); }
.session-row.phase-idle                { --strip-color: transparent; }

/* dot — larger & with more glow */
.sess-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.5s ease, box-shadow 0.5s ease, transform 0.2s ease;
}
.session-row:hover .sess-dot {
  transform: scale(1.25);
}
.sess-dot.phase-idle                 { background: var(--text-muted); }
.sess-dot.phase-thinking             { background: var(--thinking); box-shadow: 0 0 6px rgba(249,115,22,0.5); }
.sess-dot.phase-working              { background: var(--working); box-shadow: 0 0 6px rgba(249,115,22,0.5); animation: pulse-dot 1.4s ease-in-out infinite; }
.sess-dot.phase-awaiting_permission  { background: var(--warning); box-shadow: 0 0 6px rgba(245,158,11,0.5); animation: pulse-dot 0.8s ease-in-out infinite; }

@keyframes pulse-dot {
  0%,100% { opacity: 1; }
  50%     { opacity: 0.35; }
}

.sess-name {
  flex: 1; font-size: 12px; font-weight: 500; color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  line-height: 1.3;
}

/* phase badge — small pill */
.sess-phase {
  font-size: 10px; font-weight: 500; flex-shrink: 0;
  max-width: 88px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 2px 7px; border-radius: 4px;
  color: var(--text-secondary);
  background: rgba(148,163,184,0.06);
}

.sess-meta {
  font-size: 10px; font-weight: 400; color: var(--text-muted);
  flex-shrink: 0; font-variant-numeric: tabular-nums;
}

/* ---- empty ---- */
.empty-hint {
  font-size: 12px; color: var(--text-muted);
  text-align: center; padding: 20px 0 10px;
  line-height: 1.5;
}

/* ---- fold ---- */
.fold-section {
  border-top: 1px solid var(--border);
  padding-top: 8px; margin-top: 4px;
}
.fold-toggle {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
  color: var(--text-muted);
}
.fold-toggle:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}
.fold-chevron {
  flex-shrink: 0; color: inherit;
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.fold-chevron.open { transform: rotate(90deg); }
.fold-label { font-size: 11px; font-weight: 500; color: inherit; }
.fold-badge {
  margin-left: auto; font-size: 10px; font-weight: 600;
  background: rgba(148,163,184,0.08); color: var(--text-muted);
  padding: 2px 7px; border-radius: 4px; min-width: 16px; text-align: center;
}
.fold-list {
  margin-top: 2px;
  padding-left: 2px;
}
</style>
