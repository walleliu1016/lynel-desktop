<!-- 新建 / 编辑定时任务。
     新建与复制是两栏：左栏选模板（可搜索 / 分组 / 我的模板），右栏填表单。
     编辑是单栏：内容已经在，套模板会覆盖用户的改动，所以不给左栏。
     执行频率共 3 种模式 + 自定义 crontab，cron 表达式由主进程构造 ——
     渲染层不实现第二份「预设 ↔ cron」模板（历史上那份已经和主进程漂移过）。
     预览与摘要都来自 tasks:preview。 -->
<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="dlg" :class="twoCol ? 'wide' : 'narrow'">
      <div class="dlg-hd">
        {{ title }}
        <span class="sub">{{ subtitle }}</span>
        <span class="x" @click="$emit('close')"><Icon name="close" :size="16" /></span>
      </div>

      <div class="dlg-cols">
        <div v-if="twoCol" class="rail">
          <div class="rail-hd">
            <div class="search">
              <Icon name="search" :size="12" />
              <input v-model="keyword" placeholder="搜索模板…" />
            </div>
          </div>
          <div class="rail-list">
            <!-- 「空白任务」置顶且不参与分组：它是默认起点，不该埋在列表最下面 -->
            <button
              class="rail-item rail-pin"
              :class="{ on: BLANK_TEMPLATE.id === selectedTemplateId }"
              @click="applyTemplate(blankRail)"
            >
              <Icon :name="BLANK_TEMPLATE.icon" :size="14" />
              <span class="rn">{{ BLANK_TEMPLATE.name }}</span>
            </button>
            <template v-for="g in groups" :key="g.label">
              <div class="micro group">{{ g.label }}</div>
              <button
                v-for="t in g.items"
                :key="t.id"
                class="rail-item"
                :class="{ on: t.id === selectedTemplateId }"
                @click="applyTemplate(t)"
              >
                <Icon :name="t.icon" :size="14" />
                <span class="rn">{{ t.name }}</span>
                <span v-if="t.mine" class="rmark">我的</span>
              </button>
            </template>
            <div v-if="groups.length === 0" class="rail-empty">没有匹配的模板</div>
          </div>
          <div class="rail-ft">
            <template v-if="savingTemplate">
              <input
                v-model="templateName"
                class="inp"
                placeholder="模板名称"
                @keydown.enter="confirmSaveTemplate"
              />
              <div class="rail-ft-row">
                <button class="btn" @click="savingTemplate = false">取消</button>
                <button class="btn primary" :disabled="!templateName.trim()" @click="confirmSaveTemplate">
                  保存
                </button>
              </div>
            </template>
            <button v-else class="btn" @click="startSaveTemplate">
              <Icon name="bookmark" :size="13" />从当前内容新建模板
            </button>
          </div>
        </div>

        <div class="form">
          <div class="form-bd">
            <!-- 1 模板来源：名称并进这张卡，省掉一整行（一屏要放得下后面所有内容） -->
            <div class="sec">
              <div class="tmpl-card">
                <span class="ti"><Icon :name="currentIcon" :size="17" /></span>
                <input
                  v-model="name"
                  class="inp name-inp"
                  aria-label="任务名称"
                  :placeholder="currentName"
                />
                <span class="blurb">{{ currentBlurb }}</span>
              </div>
            </div>

            <!-- 2 执行频率 -->
            <div class="sec">
              <div class="sec-hd"><span class="t">执行频率</span></div>
              <div class="radios">
                <button
                  v-for="k in KINDS"
                  :key="k.v"
                  class="radio"
                  :class="{ on: kind === k.v }"
                  @click="kind = k.v"
                >{{ k.label }}</button>
              </div>

              <!-- 执行时间：每天、以及「每 N 天 / 每 N 个月」都要它（后者没有它就只能在 00:00 跑） -->
              <div v-if="needsTime" class="field">
                <label>执行时间</label>
                <div class="ctl row">
                  <select v-model.number="hour" class="inp mono">
                    <option v-for="h in HOURS" :key="h" :value="h">{{ pad(h) }}</option>
                  </select>
                  <span class="dim">:</span>
                  <select v-model.number="minute" class="inp mono">
                    <option v-for="m in MINUTES" :key="m" :value="m">{{ pad(m) }}</option>
                  </select>
                </div>
              </div>

              <div v-if="kind === 'interval'" class="field">
                <label>间隔</label>
                <div class="ctl row">
                  <span class="dim small">每</span>
                  <select v-model.number="intervalN" class="inp mono">
                    <option v-for="n in intervalOptions" :key="n" :value="n">{{ n }}</option>
                  </select>
                  <select v-model="unit" class="inp">
                    <option v-for="u in UNITS" :key="u.v" :value="u.v">{{ u.label }}</option>
                  </select>
                </div>
              </div>
              <div v-if="kind === 'interval' && unit === 'month'" class="field">
                <label>几号</label>
                <div class="ctl row">
                  <span class="dim small">每月</span>
                  <select v-model.number="dayOfMonth" class="inp mono">
                    <option v-for="d in DAYS_OF_MONTH" :key="d" :value="d">{{ d }}</option>
                  </select>
                  <span class="dim small">号</span>
                </div>
              </div>

              <template v-if="kind === 'once'">
                <div class="field">
                  <label>执行日期</label>
                  <div class="ctl"><input v-model="onceDate" class="inp mono" type="date" /></div>
                </div>
                <div class="field">
                  <label>执行时间</label>
                  <div class="ctl row">
                    <select v-model.number="hour" class="inp mono">
                      <option v-for="h in HOURS" :key="h" :value="h">{{ pad(h) }}</option>
                    </select>
                    <span class="dim">:</span>
                    <select v-model.number="minute" class="inp mono">
                      <option v-for="m in MINUTES" :key="m" :value="m">{{ pad(m) }}</option>
                    </select>
                  </div>
                </div>
              </template>

              <div v-if="kind === 'cron'" class="field">
                <label>表达式</label>
                <div class="ctl">
                  <input v-model="cron" class="inp mono full" placeholder="0 9 * * 1-5" />
                  <div class="hint">分 时 日 月 星期 —— 例 <span class="mono">0 9 * * 1-5</span> 表示工作日 09:00</div>
                </div>
              </div>

              <!-- 生效的天：只有「每天 / 每分钟 / 每小时」能精确表达周几；
                   「每 N 天 / 月」的 dow 会与 日/月 字段构成 OR 语义（cron 的坑），故不给 -->
              <div v-if="showsWeekdays" class="field">
                <label>生效的天</label>
                <div class="ctl">
                  <div class="row">
                    <div class="week">
                      <button
                        v-for="d in UI_DAYS"
                        :key="d"
                        class="wd"
                        :class="{ on: days.includes(d) }"
                        :title="`周${uiDayLabel(d)}`"
                        @click="toggleDay(d)"
                      >{{ uiDayLabel(d) }}</button>
                    </div>
                    <div class="presets">
                      <button class="preset" @click="setDays([1, 2, 3, 4, 5])">工作日</button>
                      <button class="preset" @click="setDays([6, 7])">周末</button>
                      <button class="preset" @click="setDays([...UI_DAYS])">全选</button>
                    </div>
                    <span class="chip">{{ daysLabel(cronDays) }}</span>
                    <span v-if="days.length === 0" class="warn-inline">至少选一天</span>
                  </div>
                </div>
              </div>
              <div v-else-if="kind === 'interval'" class="hint block">
                「每 N 天 / 月」不能同时限定星期 —— 要按周几跑请改用「每天 + 生效的天」。
              </div>

              <div v-if="kind !== 'once'" class="field">
                <label>生效区间</label>
                <div class="ctl row">
                  <button class="radio" :class="{ on: !bounded }" @click="bounded = false">不限</button>
                  <button class="radio" :class="{ on: bounded }" @click="bounded = true">指定区间</button>
                  <template v-if="bounded">
                    <input v-model="fromDate" class="inp mono" type="date" />
                    <span class="dim small">到</span>
                    <input v-model="toDate" class="inp mono" type="date" />
                  </template>
                  <span v-else class="dim small">长期有效</span>
                </div>
              </div>

              <div class="preview">
                <span class="micro">接下来 3 次</span>
                <span v-for="n in preview.nextRuns" :key="n" class="pl">{{ fmtRun(n) }}</span>
                <span v-if="preview.nextRuns.length === 0" class="dim">
                  {{ preview.error || (kind === 'once' ? '运行时间已过，请选将来的时间' : '—') }}
                </span>
                <span class="sp" />
                <!-- 人读摘要放这儿：原本占卡片一整行，现在跟接下来 3 次同行 -->
                <span v-if="preview.summary" class="mono dim" style="font-size: 11px">
                  {{ preview.summary }}
                </span>
              </div>
            </div>

            <!-- 3 内容 -->
            <div class="sec">
              <div class="sec-hd"><span class="t">任务内容</span></div>
              <textarea v-model="prompt" class="inp" placeholder="写下这个任务要做什么…" />
              <div class="hint">
                <Icon name="warning" :size="12" />
                <span>要操作某个项目，请在 prompt 里写它的绝对路径。</span>
              </div>
            </div>

            <!-- 没有「高级」折叠区：唯一想放进去的「运行 Agent」是假的 ——
                 runner 永远用 claude 的路径与参数 spawn，tasks.agent 不参与执行。
                 存一个被忽略的值比不显示这个控件更糟。 -->

            <div class="warn">
              <Icon name="warning" :size="14" />
              <span>
                定时任务无人值守运行，将以完全权限执行（<span class="mono">bypassPermissions</span>），
                请确认任务内容可信。
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="dlg-ft">
        <button v-if="twoCol" class="btn" :disabled="!prompt.trim()" @click="startSaveTemplate">
          <Icon name="bookmark" :size="13" />保存为模板
        </button>
        <span class="sp" />
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn primary tall" :disabled="!canSubmit" @click="submit">
          {{ mode === 'edit' ? '保存' : '创建任务' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import { useTasksStore } from '../../stores/tasks'
import { UI_DAYS, cronDayToUi, daysLabel, uiDayLabel, uiDayToCron } from '../../utils/tasks'
import {
  BLANK_TEMPLATE, BUILTIN_TEMPLATES, USER_TEMPLATE_ICON, type BuiltinTemplate,
} from '../../utils/taskTemplates'
import type { IntervalUnit, ScheduleDto, TaskDto, TaskTemplateDto } from '../../types/tasks'

const props = defineProps<{
  mode: 'create' | 'edit' | 'copy'
  task: TaskDto | null
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', input: { name: string; prompt: string; schedule: ScheduleDto }): void
}>()

const store = useTasksStore()

type Kind = 'daily' | 'interval' | 'once' | 'cron'
const KINDS: Array<{ v: Kind; label: string }> = [
  { v: 'daily', label: '每天' },
  { v: 'interval', label: '按间隔' },
  { v: 'once', label: '单次执行' },
  { v: 'cron', label: '自定义 crontab' },
]
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1)
const UNITS: Array<{ v: IntervalUnit; label: string }> = [
  { v: 'minute', label: '分钟' },
  { v: 'hour', label: '小时' },
  { v: 'day', label: '天' },
  { v: 'month', label: '个月' },
]
/** 每个单位给出合适的步长候选（「每 30 分钟」有用，「每 57 分钟」没有） */
const INTERVAL_OPTIONS: Record<IntervalUnit, number[]> = {
  minute: [1, 2, 5, 10, 15, 20, 30],
  hour: [1, 2, 3, 4, 6, 8, 12],
  day: [1, 2, 3, 5, 10, 15, 30],
  month: [1, 2, 3, 6],
}
const pad = (n: number) => String(n).padStart(2, '0')

/** 模板（内置 + 我的）在表单里是同一种东西，只差一个 mine 标记 */
interface RailTemplate {
  id: string
  icon: string
  name: string
  blurb: string
  prompt: string
  schedule: ScheduleDto
  mine: boolean
}

const name = ref('')
const prompt = ref('')

const kind = ref<Kind>('daily')
const hour = ref(9)
const minute = ref(0)
const days = ref<number[]>([...UI_DAYS]) // UI 约定：1=周一 … 7=周日
const intervalN = ref(3)
const unit = ref<IntervalUnit>('hour')
const dayOfMonth = ref(1)
const onceDate = ref('')
const cron = ref('0 9 * * 1-5')
const bounded = ref(false)
const fromDate = ref('')
const toDate = ref('')

const selectedTemplateId = ref<string | null>(null)
const keyword = ref('')
const savingTemplate = ref(false)
const templateName = ref('')
/** 最近用过的模板 id（本会话内），排在最前方便复用 */
const recentIds = ref<string[]>([])

const twoCol = computed(() => props.mode !== 'edit')
const needsTime = computed(
  () => kind.value === 'daily'
    || (kind.value === 'interval' && (unit.value === 'day' || unit.value === 'month')),
)
const showsWeekdays = computed(
  () => kind.value === 'daily'
    || (kind.value === 'interval' && (unit.value === 'minute' || unit.value === 'hour')),
)
const intervalOptions = computed(() => INTERVAL_OPTIONS[unit.value])
const title = computed(() =>
  props.mode === 'edit' ? '编辑任务' : props.mode === 'copy' ? '复制为新任务' : '新建任务',
)
const subtitle = computed(() =>
  props.mode === 'edit' ? '修改这个任务的调度或内容' : '选一个模板 → 确认时间 → 需要的话改改内容',
)

const myTemplates = computed<RailTemplate[]>(() =>
  store.userTemplates.map((t: TaskTemplateDto) => ({
    id: t.id,
    icon: USER_TEMPLATE_ICON,
    name: t.name,
    blurb: t.blurb,
    prompt: t.prompt,
    schedule: t.schedule,
    mine: true,
  })),
)
const builtinTemplates = computed<RailTemplate[]>(() =>
  BUILTIN_TEMPLATES.map((t: BuiltinTemplate) => ({ ...t, mine: false })),
)
const blankRail = computed<RailTemplate>(() => ({ ...BLANK_TEMPLATE, mine: false }))
/** 「空白任务」也进来，applyTemplate / currentTemplate 才能按 id 找到它 */
const allTemplates = computed(() => [blankRail.value, ...myTemplates.value, ...builtinTemplates.value])

const groups = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const hit = (t: RailTemplate) =>
    !kw || t.name.toLowerCase().includes(kw) || t.blurb.toLowerCase().includes(kw)
  const recent = recentIds.value
    .filter((id) => id !== BLANK_TEMPLATE.id) // 置顶项不进「最近使用」，否则同一条出现两次
    .map((id) => allTemplates.value.find((t) => t.id === id))
    .filter((t): t is RailTemplate => !!t)
    .filter(hit)
  return [
    { label: '最近使用', items: recent },
    { label: '我的模板', items: myTemplates.value.filter(hit) },
    { label: '内置', items: builtinTemplates.value.filter(hit) },
  ].filter((g) => g.items.length > 0)
})

const current = computed(
  () => allTemplates.value.find((t) => t.id === selectedTemplateId.value) ?? null,
)
const currentIcon = computed(() => current.value?.icon ?? 'plus')
const currentName = computed(() => current.value?.name ?? '自定义任务')
const currentBlurb = computed(() => current.value?.blurb ?? '按下面的设置创建一个任务')

const cronDays = computed(() => days.value.map(uiDayToCron))

/** 表单状态 → ScheduleDto。空串/NaN 一律归一，避免把坏值丢给主进程。 */
const schedule = computed<ScheduleDto | null>(() => {
  const win = bounded.value && fromDate.value && toDate.value
    ? {
        startAt: new Date(`${fromDate.value}T00:00:00`).getTime(),
        endAt: new Date(`${toDate.value}T23:59:59`).getTime(),
      }
    : { startAt: null, endAt: null }
  if (kind.value === 'once') {
    if (!onceDate.value) return null
    const runAt = new Date(`${onceDate.value}T${pad(hour.value)}:${pad(minute.value)}:00`).getTime()
    return Number.isFinite(runAt) ? { type: 'once', runAt } : null
  }
  if (kind.value === 'cron') {
    const expr = cron.value.trim()
    return expr ? { type: 'cron', expression: expr, ...win } : null
  }
  if (kind.value === 'interval') {
    return {
      type: 'interval',
      n: intervalN.value,
      unit: unit.value,
      // 「每 N 天 / 月」表达不了星期，主进程会拒绝受限的 days，这里给全选
      days: showsWeekdays.value ? cronDays.value : UI_DAYS.map(uiDayToCron),
      hour: hour.value as number,
      minute: minute.value as number,
      dayOfMonth: dayOfMonth.value,
      ...win,
    }
  }
  return { type: 'daily', hour: hour.value, minute: minute.value, days: cronDays.value, ...win }
})

const preview = ref<{ nextRuns: number[]; summary: string; error: string | null }>({
  nextRuns: [],
  summary: '',
  error: null,
})

/** 预览是异步 IPC：用自增 token 丢弃过期响应，避免连打时旧结果覆盖新结果 */
let previewToken = 0
async function refreshPreview() {
  const token = ++previewToken
  const s = schedule.value
  if (!s) {
    preview.value = { nextRuns: [], summary: '', error: null }
    return
  }
  try {
    const res = await store.preview(s)
    if (token !== previewToken) return
    preview.value = res
  } catch (err) {
    if (token !== previewToken) return
    preview.value = { nextRuns: [], summary: '', error: String((err as Error)?.message ?? err) }
  }
}
watch(schedule, () => void refreshPreview(), { deep: true })

/** once 且运行时间原样没动时豁免「时间已过」——否则跑过一次的一次性任务连改名都存不了 */
function onceUnmodified(): boolean {
  const raw = props.task?.scheduleRaw
  if (raw?.type !== 'once' || kind.value !== 'once' || !schedule.value) return false
  return schedule.value.type === 'once' && schedule.value.runAt === raw.runAt
}

const canSubmit = computed(() => {
  if (!name.value.trim() || !prompt.value.trim()) return false
  // 一天都没选时不能放行：主进程把空集合归一成 `*`（每天），静默存下去等于
  // 用户以为「什么都没选」而任务天天跑。宁可拦住让他明确选。
  if (kind.value === 'daily' && days.value.length === 0) return false
  const s = schedule.value
  if (!s) return false
  if (s.type === 'once') return onceUnmodified() || preview.value.nextRuns.length > 0
  return preview.value.error == null && preview.value.nextRuns.length > 0
})

/** 换单位时把间隔收敛到该单位的候选里，否则会留下「每 12 个月」这种越界值 */
watch(unit, (u) => {
  if (!INTERVAL_OPTIONS[u].includes(intervalN.value)) intervalN.value = INTERVAL_OPTIONS[u][0]
})

function toggleDay(d: number) {
  days.value = days.value.includes(d) ? days.value.filter((x) => x !== d) : [...days.value, d]
}
function setDays(next: number[]) {
  days.value = [...next]
}

/** 应用模板：只覆盖「调度 + prompt」，名称留空让用户自己起（或复用模板名作 placeholder） */
function applyTemplate(t: RailTemplate) {
  selectedTemplateId.value = t.id
  prompt.value = t.prompt
  if (t.id !== BLANK_TEMPLATE.id) {
    recentIds.value = [t.id, ...recentIds.value.filter((x) => x !== t.id)].slice(0, 3)
  }
  applySchedule(t.schedule)
}

function applySchedule(s: ScheduleDto) {
  if (s.type === 'once') {
    kind.value = 'once'
    const d = new Date(s.runAt)
    onceDate.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    hour.value = d.getHours()
    minute.value = d.getMinutes()
    return
  }
  bounded.value = s.startAt != null && s.endAt != null
  if (bounded.value) {
    fromDate.value = toDateInput(s.startAt!)
    toDate.value = toDateInput(s.endAt!)
  }
  if (s.type === 'cron') {
    kind.value = 'cron'
    cron.value = s.expression
    return
  }
  if (s.type === 'interval') {
    kind.value = 'interval'
    intervalN.value = s.n
    unit.value = s.unit
    hour.value = s.hour
    minute.value = s.minute
    dayOfMonth.value = s.dayOfMonth
    if (s.unit === 'minute' || s.unit === 'hour') days.value = s.days.map(cronDayToUi)
    return
  }
  kind.value = 'daily'
  hour.value = s.hour
  minute.value = s.minute
  days.value = s.days.map(cronDayToUi)
}

const toDateInput = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function startSaveTemplate() {
  if (!prompt.value.trim()) return
  templateName.value = current.value?.name ?? name.value.trim() ?? ''
  savingTemplate.value = true
}

async function confirmSaveTemplate() {
  const t = templateName.value.trim()
  if (!t || !schedule.value) return
  await store.saveTemplate({
    name: t,
    icon: USER_TEMPLATE_ICON,
    blurb: '我保存的模板',
    prompt: prompt.value,
    schedule: schedule.value,
  })
  savingTemplate.value = false
}

function fmtRun(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const dayOnly = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((dayOnly(d) - dayOnly(today)) / 86400000)
  if (diff === 0) return `今天 ${time}`
  if (diff === 1) return `明天 ${time}`
  if (diff === 2) return `后天 ${time}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
}

function submit() {
  const s = schedule.value
  if (!s) return
  emit('submit', { name: name.value.trim(), prompt: prompt.value, schedule: s })
}

onMounted(() => {
  if (props.task) {
    // 复制：名称加后缀，其余（调度 + 内容）原样，用户再改
    name.value = props.mode === 'copy' ? `${props.task.name}（副本）` : props.task.name
    prompt.value = props.task.prompt
    applySchedule(props.task.scheduleRaw)
  } else {
    // 默认从「空白任务」开始：模板是加速器，不该替用户预设任务内容
    applyTemplate(blankRail.value)
    onceDate.value = toDateInput(Date.now() + 86400000)
  }
  if (!fromDate.value) fromDate.value = toDateInput(Date.now())
  if (!toDate.value) toDate.value = toDateInput(Date.now() + 30 * 86400000)
  void refreshPreview()
})
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 26px;
  background: var(--scrim);
}
.dlg {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  max-height: 100%;
  background: var(--bg-panel);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  overflow: hidden;
}
/* 高度给足，让「执行频率 + 任务内容」在一屏内看完，不必滚 */
.dlg.wide { width: 812px; height: min(720px, 92vh); }
.dlg.narrow { width: 580px; }
.dlg-hd {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 15px 20px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  font-size: var(--fs-body);
  flex: none;
}
.dlg-hd .sub { font-weight: 400; font-size: var(--fs-caption); color: var(--text-tertiary); }
.dlg-hd .x { margin-left: auto; align-self: center; color: var(--text-tertiary); cursor: pointer; display: flex; }
.dlg-hd .x:hover { color: var(--text-primary); }

.dlg-cols { flex: 1; min-height: 0; display: flex; }

/* 左栏：模板。数量再多也只让这一栏滚，右栏表单位置不动 */
.rail {
  width: 236px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--bg-primary);
  min-height: 0;
}
.rail-hd { padding: 10px; border-bottom: 1px solid var(--border); }
.rail-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; }
.rail .group { padding: 10px 9px 4px; }
.rail-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}
.rail-item:hover { background: var(--bg-hover); }
.rail-item.on { background: var(--accent-soft-bg); color: var(--accent); font-weight: 500; }
.rail-item .rn { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-item .rmark {
  font-size: 9px;
  letter-spacing: .5px;
  color: var(--text-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 0 5px;
  flex: none;
}
.rail-item.on .rmark { color: var(--accent); border-color: var(--accent-soft-border); }
/* 置顶的「空白任务」与下面的分组断开一点 */
.rail-pin { margin-bottom: 6px; }
.rail-ft {
  padding: 8px 10px 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rail-ft .btn { justify-content: center; width: 100%; }
.rail-ft-row { display: flex; gap: 6px; }
.rail-ft-row .btn { flex: 1; }
.rail-empty { padding: 20px 12px; text-align: center; font-size: var(--fs-caption); color: var(--text-tertiary); }

.form { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.form-bd {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.sec { display: flex; flex-direction: column; gap: 10px; }
.sec-hd { display: flex; align-items: baseline; gap: 9px; }
.sec-hd .t { font-size: var(--fs-body-sm); font-weight: 600; color: var(--text-primary); }
.sec-hd .d { font-size: 11px; color: var(--text-tertiary); }

.tmpl-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}
.tmpl-card .ti {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft-bg);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.tmpl-card .name-inp { flex: 1; min-width: 0; font-size: var(--fs-body-sm); font-weight: 600; }
.tmpl-card .blurb {
  flex: none;
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}

.field { display: flex; gap: 10px; align-items: flex-start; }
.field > label { width: 52px; flex: none; font-size: var(--fs-caption); color: var(--text-secondary); padding-top: 8px; }
.field > .ctl { flex: 1; min-width: 0; }
.ctl.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.inp.full { width: 100%; }

.radios { display: flex; flex-wrap: wrap; gap: 6px; }
/* 执行频率的模式行不换行：窄窗口下最后一个会被挤到第二行，读起来像"掉下去了" */
.sec > .radios:first-of-type { flex-wrap: nowrap; }
.radio {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  font-size: var(--fs-caption);
  font-family: inherit;
  color: var(--text-secondary);
  cursor: pointer;
  background: var(--bg-card);
  user-select: none;
}
.radio:hover { background: var(--bg-hover); }
.radio.on { border-color: var(--accent); background: var(--accent-soft-bg); color: var(--accent); font-weight: 500; }

.preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  font-size: var(--fs-caption);
  flex-wrap: wrap;
}
.preview .pl {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--text-primary);
}

.hint {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.5;
}
.hint.block { display: block; padding-left: 62px; }
.warn-inline { font-size: 11px; color: var(--status-error); }
.hint svg { margin-top: 2px; flex: none; }

.warn {
  display: flex;
  gap: 9px;
  padding: 11px 13px;
  background: var(--status-warn-bg);
  border: 1px solid var(--status-warn-border);
  border-radius: var(--radius-sm);
  font-size: var(--fs-caption);
  line-height: 1.55;
  color: var(--text-primary);
}
.warn svg { color: var(--status-warn); flex: none; margin-top: 1px; }

.dlg-ft {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
  background: var(--bg-primary);
  flex: none;
}
.dlg-ft .sp { flex: 1; }
.dlg-ft .btn:disabled { opacity: .5; cursor: not-allowed; }

.search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
}
.search:focus-within { border-color: var(--border-focus); }
.search :deep(svg) { color: var(--text-tertiary); flex: none; }
.search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: var(--fs-caption);
  color: var(--text-primary);
  padding: 6px 0;
}
.search input::placeholder { color: var(--text-tertiary); }
</style>
