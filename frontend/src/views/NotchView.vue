<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
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
const PILL_H = 32
const EXPAND_W = 380
const EXPAND_H = 360

const expanded = ref(false)
const pendingReq = ref<PermissionReq | null>(null)
const isActive = ref(false)
const sessionList = ref<SessionMeta[]>([])
const sessionActivity = ref<Record<string, SessionActivity>>({})
const askQuestions = ref<AskQuestion[]>([])
const askAnswers = ref<Record<string, string | string[]>>({})
const customInputs = ref<Record<string, string>>({})
const activeQIndex = ref(0)
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
  if (pendingReq.value && !isAsk.value) return '#FFB300'
  if (activePhase.value === 'working') return '#D97857'
  if (activePhase.value === 'thinking') return '#B0A08A'
  return '#555'
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
    const preview = input.length > 36 ? input.slice(0, 36) + '...' : input
    return preview ? `${working.tool}: ${preview}` : working.tool || '工作中'
  }
  if (acts.some(a => a.phase === 'thinking')) return '思考中'
  if (isActive.value) return '工作中'
  return 'Lynel'
})

const isProcessing = computed(() => activePhase.value === 'working' || activePhase.value === 'thinking')

// ---- hover ----
function cancelCollapse() {
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null }
}

function onMouseEnter() {
  cancelCollapse()
  if (!expanded.value) {
    expanded.value = true
    SetNotchSize(EXPAND_W, EXPAND_H)
    fetchSessions()
  }
}

function onMouseLeave() {
  if (!expanded.value) return
  if (pendingReq.value && !isAsk.value) return
  collapseTimer = window.setTimeout(() => {
    if (!pendingReq.value || isAsk.value) {
      expanded.value = false
      SetNotchSize(PILL_W, PILL_H)
    }
    collapseTimer = null
  }, 300)
}

function onWindowBlur() {
  setTimeout(() => {
    if (!document.hasFocus() && !pendingReq.value) {
      expanded.value = false
      SetNotchSize(PILL_W, PILL_H)
    }
  }, 100)
}

async function fetchSessions() {
  try { sessionList.value = (await ListSessions()) as SessionMeta[] } catch { sessionList.value = [] }
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
    // 单选：选中预设选项时清自定义输入
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
    // 单选：自定义输入替换预设选择
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
      // 多选：合并预设选项 + 自定义文本
      const merged: string[] = []
      if (Array.isArray(preset)) merged.push(...preset)
      if (custom) merged.push(custom)
      if (merged.length > 0) result[q.question] = merged
    } else {
      // 单选：自定义优先，否则用预设
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
  if (a.phase === 'working') return a.tool || 'working'
  if (a.phase === 'thinking') return 'thinking'
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
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro", "PingFang SC", "Microsoft YaHei", sans-serif;
      -webkit-app-region: no-drag;
      user-select: none;
    }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
  `
  document.head.appendChild(style)

  window.addEventListener('blur', onWindowBlur)

  cleanups.push(EventsOn('sessions:state:changed', async (_id: string, state: string) => {
    if (state === 'running') {
      isActive.value = true
    } else {
      try {
        const states = await GetSessionStates()
        isActive.value = Object.values(states).some(s => s === 'running')
      } catch {}
    }
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
        SetNotchSize(EXPAND_W, EXPAND_H)
      }
      fetchSessions()
    } catch {}
  }))

  // 用户在终端自行解决权限时，broker 取消 → 关闭权限 UI
  cleanups.push(EventsOn('permission:cancelled', (payload: string) => {
    try {
      const data = JSON.parse(payload)
      if (pendingReq.value && pendingReq.value.sessionId === data.sessionId) {
        resetAsk()
        collapseTimer = window.setTimeout(() => {
          expanded.value = false
          SetNotchSize(PILL_W, PILL_H)
          collapseTimer = null
        }, 300)
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
    <div class="pill-card" :class="{ 'is-expanded': expanded }">
      <!-- header -->
      <div class="pill-header">
        <div class="header-left">
          <svg width="18" height="14" viewBox="0 0 66 52" class="crab-svg" :class="{ 'is-active': isProcessing }">
            <g :fill="crabColor">
              <rect x="0" y="13" width="6" height="13" rx="1" class="leg leg-l1" />
              <rect x="60" y="13" width="6" height="13" rx="1" class="leg leg-r1" />
              <rect x="6" y="39" width="6" height="13" rx="1" class="leg leg-l2" />
              <rect x="18" y="39" width="6" height="13" rx="1" class="leg leg-l3" />
              <rect x="42" y="39" width="6" height="13" rx="1" class="leg leg-r2" />
              <rect x="54" y="39" width="6" height="13" rx="1" class="leg leg-r3" />
              <rect x="6" y="0" width="54" height="39" rx="3" class="body" />
            </g>
            <rect x="12" y="13" width="6" height="6.5" rx="1" fill="#000" />
            <rect x="48" y="13" width="6" height="6.5" rx="1" fill="#000" />
          </svg>
        </div>

        <div class="header-center">
          <span class="header-title">{{ headerText }}</span>
        </div>

        <div class="header-right">
          <span v-if="pendingReq && !isAsk" class="dot amber" />
          <span v-else-if="activePhase === 'working'" class="dot active" />
          <span v-else-if="activePhase === 'thinking'" class="dot thinking" />
          <span v-else-if="isActive" class="dot active" />
          <span v-else class="dot idle" />
        </div>
      </div>

      <!-- body -->
      <div v-if="expanded" class="pill-body">
        <!-- AskUserQuestion -->
        <div v-if="isAsk && askQuestions.length" class="ask-card" @click.stop>
          <!-- 问题 tab 切换 -->
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

          <!-- 当前问题 -->
          <div class="ask-block">
            <div class="ask-header">{{ askQuestions[activeQIndex].header }}</div>
            <div class="ask-q">{{ askQuestions[activeQIndex].question }}</div>

            <!-- 预设选项 -->
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

            <!-- 自定义输入 -->
            <div class="ask-custom">
              <input
                class="custom-input"
                :value="customInputs[askQuestions[activeQIndex].question] || ''"
                @input="setCustomAnswer(askQuestions[activeQIndex].question, ($event.target as HTMLInputElement).value, askQuestions[activeQIndex].multiSelect)"
                placeholder="或输入自定义内容..."
              />
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="ask-btns">
            <button class="btn-deny" @click="handleDeny">跳过</button>
            <button class="btn-allow" @click="handleApprove">提交</button>
          </div>
        </div>

        <!-- 权限卡片 -->
        <div v-else-if="pendingReq" class="perm-card" @click.stop>
          <div class="cmd-preview">{{ getCommandPreview(pendingReq.toolInput) }}</div>
          <div class="perm-btns">
            <button class="btn-deny" @click="handleDeny">拒绝</button>
            <button class="btn-allow" @click="handleApprove">允许</button>
          </div>
        </div>

        <!-- 会话列表 -->
        <div v-if="sessionList.length" class="session-list" @click.stop>
          <div
            v-for="s in sessionList"
            :key="s.id"
            class="session-row"
          >
            <span class="sess-dot" :class="getPhaseClass(s.id)" />
            <span class="sess-name">{{ s.project || s.first_prompt || s.id.slice(0, 8) }}</span>
            <span class="sess-phase">{{ getPhaseLabel(s.id) }}</span>
            <span class="sess-meta">{{ s.msg_count }} msgs</span>
          </div>
        </div>
        <div v-else-if="!pendingReq" class="empty-hint" @click.stop>暂无活跃会话</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ---- shell ---- */
.island-shell {
  position: fixed;
  top: 0; left: 50%;
  transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center;
  pointer-events: auto;
}

/* ---- pill card ---- */
.pill-card {
  background: #000;
  width: 240px;
  min-height: 32px;
  border-radius: 0 0 14px 14px;
  overflow: hidden;
  display: flex; flex-direction: column;
  transition: width 0.42s cubic-bezier(0.22, 0.99, 0.51, 1.02),
              min-height 0.42s cubic-bezier(0.22, 0.99, 0.51, 1.02),
              border-radius 0.42s cubic-bezier(0.22, 0.99, 0.51, 1.02),
              box-shadow 0.42s cubic-bezier(0.22, 0.99, 0.51, 1.02);
}

.pill-card.is-expanded {
  width: 380px;
  border-radius: 0 0 24px 24px;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 12px 40px rgba(0,0,0,0.8);
}

/* ---- header ---- */
.pill-header {
  display: flex; align-items: center;
  height: 32px; padding: 0 12px;
  flex-shrink: 0;
}
.header-left  { width: 28px; flex-shrink: 0; display: flex; align-items: center; }
.header-right { width: 28px; flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; }
.header-center {
  flex: 1; display: flex; align-items: center; justify-content: center;
  overflow: hidden; padding: 0 4px;
}
.header-title {
  font-size: 11px; color: #999;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.crab-svg { flex-shrink: 0; }

/* ---- crab leg animation ---- */
.crab-svg.is-active .leg {
  animation: leg-wave 0.6s ease-in-out infinite;
}
.crab-svg.is-active .leg-l1 { animation-delay: 0s; }
.crab-svg.is-active .leg-r1 { animation-delay: 0.15s; }
.crab-svg.is-active .leg-l2 { animation-delay: 0.3s; }
.crab-svg.is-active .leg-r2 { animation-delay: 0.1s; }
.crab-svg.is-active .leg-l3 { animation-delay: 0.2s; }
.crab-svg.is-active .leg-r3 { animation-delay: 0.25s; }

@keyframes leg-wave {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-2px); }
}

/* ---- dots ---- */
.dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.dot.idle     { background: #444; }
.dot.active   { background: #D97857; animation: pulse-dot 1.4s ease-in-out infinite; }
.dot.thinking { background: #B0A08A; animation: pulse-dot 2s ease-in-out infinite; }
.dot.amber    { background: #FFB300; animation: pulse-dot 0.8s ease-in-out infinite; }
@keyframes pulse-dot {
  0%,100% { opacity: 1; }
  50%     { opacity: 0.3; }
}

/* ---- body ---- */
.pill-body {
  padding: 6px 14px 12px;
  display: flex; flex-direction: column; gap: 6px;
  max-height: 320px; overflow-y: auto;
  animation: fadeDown 0.25s ease;
}
@keyframes fadeDown {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ---- ask tabs ---- */
.ask-tabs {
  display: flex; gap: 4px; justify-content: center;
}
.ask-tab {
  width: 24px; height: 24px; border-radius: 50%;
  border: 1px solid #444; background: transparent;
  color: #777; font-size: 11px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.ask-tab.active {
  border-color: #66BF73; color: #66BF73; background: rgba(102,191,115,0.1);
}
.ask-tab.done {
  border-color: #66BF73; color: #66BF73;
}
.ask-tab.done::after {
  content: ''; position: absolute;
}

/* ---- ask card ---- */
.ask-card {
  display: flex; flex-direction: column; gap: 4px;
}
.ask-block {
  background: rgba(255,255,255,0.04);
  border-radius: 8px; padding: 6px 10px;
}
.ask-header {
  font-size: 10px; color: #666; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px;
}
.ask-q {
  font-size: 12px; color: #ddd; margin-bottom: 4px; line-height: 1.35;
}
.ask-options {
  display: flex; flex-direction: column; gap: 1px;
  max-height: 160px; overflow-y: auto;
}
.ask-opt {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 8px; border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}
.ask-opt:hover { background: rgba(255,255,255,0.06); }
.ask-opt.selected { background: rgba(102,191,115,0.1); }

.ask-radio, .ask-check {
  width: 13px; height: 13px; border-radius: 50%;
  border: 1.5px solid #555; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.15s, background 0.15s;
}
.ask-radio.on, .ask-check.on {
  border-color: #66BF73; background: rgba(102,191,115,0.25);
}
.ask-radio.on::after {
  content: ''; width: 5px; height: 5px; border-radius: 50%; background: #66BF73;
}
.ask-check {
  border-radius: 3px;
}
.ask-check.on::after {
  content: '✓'; font-size: 8px; color: #66BF73; line-height: 1;
}

.ask-label { font-size: 12px; color: #ccc; }
.ask-desc { font-size: 10px; color: #555; margin-left: auto; white-space: nowrap; }

/* ---- custom input ---- */
.ask-custom {
  margin-top: 4px;
}
.custom-input {
  width: 100%; box-sizing: border-box;
  padding: 5px 8px; border-radius: 6px;
  background: rgba(255,255,255,0.06); border: 1px solid #333;
  color: #ccc; font-size: 11px; outline: none;
  transition: border-color 0.15s;
}
.custom-input::placeholder { color: #555; }
.custom-input:focus { border-color: #66BF73; }

/* ---- buttons ---- */
.ask-btns { display: flex; gap: 8px; }
.ask-btns button {
  flex: 1; padding: 6px 0; border: none; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer;
}

/* ---- permission card ---- */
.perm-card {
  background: rgba(255,255,255,0.05);
  border-radius: 8px; padding: 8px 10px;
}
.cmd-preview {
  font-family: Consolas, monospace;
  font-size: 11px; color: #aab;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-bottom: 8px;
}
.perm-btns { display: flex; gap: 8px; }
.perm-btns button {
  flex: 1; padding: 6px 0; border: none; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
}
.btn-deny { background: rgba(255,77,77,0.15); color: #FF4D4D; }
.btn-deny:hover { background: rgba(255,77,77,0.28); }
.btn-allow { background: rgba(102,191,115,0.15); color: #66BF73; }
.btn-allow:hover { background: rgba(102,191,115,0.28); }

/* ---- session list ---- */
.session-list {
  display: flex; flex-direction: column; gap: 2px;
  max-height: 200px; overflow-y: auto;
}
.session-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 8px;
  transition: background 0.15s;
  cursor: default;
}
.session-row:hover { background: rgba(255,255,255,0.06); }

.sess-dot {
  width: 6px; height: 6px; border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.3s;
}
.sess-dot.phase-idle     { background: #444; }
.sess-dot.phase-thinking { background: #B0A08A; }
.sess-dot.phase-working  { background: #D97857; animation: pulse-dot 1.2s ease-in-out infinite; }
.sess-dot.phase-awaiting_permission { background: #FFB300; animation: pulse-dot 0.8s ease-in-out infinite; }

.sess-name {
  flex: 1; font-size: 12px; color: #ccc;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sess-phase {
  font-size: 10px; color: #888; flex-shrink: 0;
  max-width: 80px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sess-meta { font-size: 10px; color: #555; flex-shrink: 0; }
.empty-hint { font-size: 11px; color: #444; text-align: center; padding: 12px 0; }
</style>
