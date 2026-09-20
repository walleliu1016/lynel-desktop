<!-- 新建 / 编辑定时任务表单。
     预设是「表达式构造器」：选预设拼出 cron 回填表达式框；手改表达式命中模板则预设自动跳回对应项，否则落「自定义」。
     表达式 → 预设的反查（detectPreset / applyExprToPreset）与主进程 src/main/tasks/schedule.ts 的 cronToPreset 是
     同一套模板的**有意重复**：主进程与渲染层是两个 bundle，不能互相 import，走 IPC 会让拖数字时回填变异步卡顿。
     注意 once 不走 cron（主进程 presetToCron 对 'once' 直接抛错），这里必须先分支成 { type: 'once', runAt }。 -->
<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="dlg">
      <div class="dlg-hd">
        {{ task ? '编辑任务' : '新建任务' }}
        <span class="x" @click="$emit('close')"><Icon name="close" :size="16" /></span>
      </div>

      <div class="dlg-bd">
        <div class="fld">
          <label>名称</label>
          <div class="ctl"><input v-model="name" class="inp" placeholder="每日 CI 失败巡检" /></div>
        </div>

        <div class="fld">
          <label>Prompt</label>
          <div class="ctl col">
            <textarea v-model="prompt" class="inp" placeholder="检查最近的 CI 失败，定位原因并修复，完成后提交并推送。" />
            <!-- 文案整体包一个 span：.hint 是 flex 容器，散落的文本节点会被当成多个 flex item 排成列 -->
            <div class="hint">
              <Icon name="warning" :size="12" />
              <span>任务在固定的任务目录（<span class="mono">~/.lynel-desktop/tasks/</span>）中运行；要操作其他项目请在 prompt 里写绝对路径。</span>
            </div>
          </div>
        </div>

        <div class="fld">
          <label>调度</label>
          <div class="ctl col wide">
            <div class="radios">
              <span
                v-for="p in PRESETS"
                :key="p.kind"
                class="radio"
                :class="{ on: preset.kind === p.kind }"
                @click="pickPreset(p.kind)"
              ><span class="dot2" />{{ p.label }}</span>
            </div>

            <!-- 预设参数 -->
            <div v-if="preset.kind === 'weekly'" class="ctl wrap">
              <span
                v-for="(d, i) in WEEKDAYS"
                :key="d.value"
                class="radio"
                :class="{ on: (preset.weekdays ?? []).includes(d.value) }"
                @click="toggleWeekday(d.value)"
              >{{ WEEKDAYS_CN[i] }}</span>
            </div>
            <div v-if="preset.kind === 'monthly'" class="ctl center">
              <span class="dim small">每月</span>
              <input v-model.number="preset.dayOfMonth" class="inp mono num" type="number" min="1" max="31" />
              <span class="dim small">号</span>
            </div>
            <div v-if="preset.kind === 'everyNMinutes'" class="ctl center">
              <span class="dim small">每</span>
              <input v-model.number="preset.everyMinutes" class="inp mono num" type="number" min="1" max="59" />
              <span class="dim small">分钟</span>
            </div>

            <!-- 时间 / 日期时间 -->
            <div v-if="needsTime" class="ctl center">
              <span class="dim small">{{ preset.kind === 'hourly' ? '第' : '' }}</span>
              <input
                v-if="preset.kind === 'hourly'"
                v-model.number="preset.minute"
                class="inp mono num" type="number" min="0" max="59"
              />
              <template v-else>
                <input v-model.number="preset.hour" class="inp mono num" type="number" min="0" max="23" />
                <span class="dim">:</span>
                <input v-model.number="preset.minute" class="inp mono num" type="number" min="0" max="59" />
              </template>
              <span v-if="preset.kind === 'hourly'" class="dim small">分钟</span>
            </div>

            <div v-if="preset.kind === 'once'" class="ctl center">
              <input v-model="onceLocal" class="inp mono" type="datetime-local" />
            </div>

            <!-- 表达式（预设自动回填，也可手改） -->
            <div class="ctl center">
              <span class="dim small expr-label">表达式</span>
              <input
                :value="expression"
                class="inp mono"
                :class="{ bad: !!exprError && preset.kind !== 'once' }"
                :disabled="preset.kind === 'once'"
                @input="onExprInput"
              />
            </div>

            <div class="preview">
              <div class="ph">接下来 3 次运行</div>
              <div v-if="nextRuns.length" class="pl">
                <span v-for="n in nextRuns" :key="n">{{ fmt(n) }}</span>
              </div>
              <div v-else class="pl dim">{{ exprError || '—' }}</div>
            </div>
          </div>
        </div>

        <div class="warn">
          <Icon name="warning" :size="14" />
          <span>定时任务无人值守运行，将以完全权限执行（<span class="mono">bypassPermissions</span>），请确认任务内容可信。</span>
        </div>
      </div>

      <div class="dlg-ft">
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="!canSubmit" @click="submit">
          {{ task ? '保存' : '创建任务' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import { useTasksStore } from '../../stores/tasks'
import type { ScheduleDto, TaskDto } from '../../types/tasks'

const props = defineProps<{ task: TaskDto | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', input: { name: string; prompt: string; schedule: ScheduleDto }): void
}>()

const store = useTasksStore()

type Kind = 'daily' | 'weekly' | 'monthly' | 'hourly' | 'everyNMinutes' | 'once' | 'custom'
const PRESETS: Array<{ kind: Kind; label: string }> = [
  { kind: 'daily', label: '每天' }, { kind: 'weekly', label: '每周' },
  { kind: 'monthly', label: '每月' }, { kind: 'hourly', label: '每小时' },
  { kind: 'everyNMinutes', label: '每 N 分钟' }, { kind: 'once', label: '一次性' },
  { kind: 'custom', label: '自定义 cron' },
]
const WEEKDAYS = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }, { value: 6 }, { value: 0 }]
const WEEKDAYS_CN = ['一', '二', '三', '四', '五', '六', '日']

const name = ref(props.task?.name ?? '')
const prompt = ref(props.task?.prompt ?? '')
const preset = ref<{
  kind: Kind; hour: number; minute: number; weekdays: number[];
  dayOfMonth: number; everyMinutes: number;
}>({ kind: 'daily', hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5], dayOfMonth: 1, everyMinutes: 30 })
const onceLocal = ref('')
const manualExpr = ref<string | null>(null)
const nextRuns = ref<number[]>([])
const exprError = ref('')

/** number 输入被清空时 v-model.number 会给出 ''（不是 NaN）。必须挡住，
 *  否则 `0 9  * *` 这种缺字段的串会被 cron 解析成另一个合法表达式（静默改变语义）。 */
function inRange(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}

/** 预设 → 表达式。与主进程 schedule.ts 的 presetToCron 同一套模板（前端不能 import 主进程模块）。
 *  once 不走 cron，返回 null（调用方分支到 ScheduleDto.type='once'）。 */
function buildExpr(): string | null {
  const p = preset.value
  // 时:分（每天 / 每周 / 每月共用）
  const time = inRange(p.minute, 0, 59) && inRange(p.hour, 0, 23) ? `${p.minute} ${p.hour}` : null
  switch (p.kind) {
    case 'daily': return time ? `${time} * * *` : null
    case 'weekly': {
      if (!time || p.weekdays.length === 0) return null
      // 越界的星期一律判非法，与主进程 presetToCron 的 assertInt(d, 0, 6, '星期') 对齐：
      // 只挡 length === 0 的话，坏数组会拼出 `0 9 * * NaN` 这种「看起来像表达式」的串。
      if (!p.weekdays.every((d) => inRange(d, 0, 6))) return null
      return `${time} * * ${[...p.weekdays].sort((a, b) => a - b).join(',')}`
    }
    case 'monthly': return time && inRange(p.dayOfMonth, 1, 31) ? `${time} ${p.dayOfMonth} * *` : null
    case 'hourly': return inRange(p.minute, 0, 59) ? `${p.minute} * * * *` : null
    case 'everyNMinutes': return inRange(p.everyMinutes, 1, 59) ? `*/${p.everyMinutes} * * * *` : null
    case 'custom': return manualExpr.value?.trim() || null
    default: return null
  }
}

const expression = computed(() => {
  if (preset.value.kind === 'once') return ''
  if (manualExpr.value !== null) return manualExpr.value
  return buildExpr() ?? ''
})

/** 表达式 → 预设反查。与主进程 cronToPreset 同模板，**含区间校验**：`99 99 * * *`
 *  这种越界项必须落「自定义」（否则会被当成「每天」把 99 吞进数字框，表达式框反而被清空）。 */
function detectPreset(expr: string): Kind {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return 'custom'
  const [mi, ho, dom, mon, dow] = parts
  /** 十进制数字且不超过 max，否则 null（与主进程 cronToPreset 的 num() 一致） */
  const num = (s: string, max: number): number | null => {
    if (!/^\d+$/.test(s)) return null
    const n = Number(s)
    return n <= max ? n : null
  }
  // */N * * * *
  if (mi.startsWith('*/') && ho === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = num(mi.slice(2), 59)
    if (n !== null && n >= 1) return 'everyNMinutes'
  }
  // M * * * *
  if (num(mi, 59) !== null && ho === '*' && dom === '*' && mon === '*' && dow === '*') return 'hourly'
  if (num(mi, 59) === null || num(ho, 23) === null) return 'custom'
  // M H D * *
  if (dom !== '*' && mon === '*' && dow === '*') {
    const d = num(dom, 31)
    return d !== null && d >= 1 ? 'monthly' : 'custom'
  }
  // M H * * D[,D...]
  if (dom === '*' && mon === '*' && dow !== '*') {
    // 按数字去重（不是按字符串）：`01,1` 在主进程 num() 后是 [1,1] → 判重复，
    // 这里用字符串会比出两个不同项、把本该是「自定义」的表达式认成「每周」。
    const days: number[] = []
    for (const it of dow.split(',')) {
      const d = num(it, 6)
      if (d === null) return 'custom'
      days.push(d)
    }
    // 重复的星期（`0 9 * * 1,1`）与主进程 cronToPreset 一样落「自定义」：
    // 主进程的 describeSchedule 会回退成原始表达式，表单若认成「每周」两边就不一致了。
    return new Set(days).size === days.length ? 'weekly' : 'custom'
  }
  // M H * * *
  if (dom === '*' && mon === '*' && dow === '*') return 'daily'
  return 'custom'
}

/** 把表达式回填进预设控件（编辑已有任务 / 手改表达式命中模板时用），并清掉 manualExpr 让表达式跟随预设 */
function applyExprToPreset(expr: string) {
  const kind = detectPreset(expr)
  const parts = expr.trim().split(/\s+/)
  if (kind === 'custom' || parts.length !== 5) {
    preset.value = { ...preset.value, kind: 'custom' }
    manualExpr.value = expr
    return
  }
  // 5 段是 [分, 时, 日, 月, 星期]：第 4 段（月）用不到，但必须占位跳过，
  // 否则 dow 会绑到 month 上 —— 此时 weekly 分支只会拿到 mon === '*' 的表达式，
  // dow 恒为 '*' → weekdays = [NaN] → 表达式被写成 `0 9 * * NaN`。
  const [mi, ho, dom, , dow] = parts
  preset.value = {
    ...preset.value,
    kind,
    minute: kind === 'everyNMinutes' ? 0 : Number(mi),
    hour: ho === '*' ? preset.value.hour : Number(ho),
    dayOfMonth: kind === 'monthly' ? Number(dom) : preset.value.dayOfMonth,
    weekdays: kind === 'weekly' ? dow.split(',').map(Number) : preset.value.weekdays,
    everyMinutes: kind === 'everyNMinutes' ? Number(mi.slice(2)) : preset.value.everyMinutes,
  }
  manualExpr.value = null
}

const needsTime = computed(() => ['daily', 'weekly', 'monthly', 'hourly'].includes(preset.value.kind))

/** 一次性任务的运行时间是否**原样没动**（与已存任务的 runAt 逐毫秒相同）。
 *  跑过一次的 once 任务 nextRunAt 已被清空，preview 必返回空 → exprError='运行时间已过'；
 *  没有这个豁免，改个名字都存不了（唯一出路是重选时间，那等于静默改期）。 */
function onceUnmodified(): boolean {
  const raw = props.task?.scheduleRaw
  if (raw?.type !== 'once') return false
  const s = scheduleDto()
  return s?.type === 'once' && s.runAt === raw.runAt
}

const canSubmit = computed(() => {
  if (!name.value.trim() || !prompt.value.trim()) return false
  if (preset.value.kind === 'once') {
    return onceLocal.value !== '' && (onceUnmodified() || !exprError.value)
  }
  return expression.value !== '' && !exprError.value
})

function pickPreset(kind: Kind) {
  preset.value = { ...preset.value, kind }
  manualExpr.value = null
}
function toggleWeekday(d: number) {
  const cur = preset.value.weekdays
  preset.value = { ...preset.value, weekdays: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d] }
}
function onExprInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  manualExpr.value = v
  const detected = detectPreset(v)
  if (detected !== 'custom') {
    // 手改后若命中模板，同步刷新预设表单，让控件跟着动
    applyExprToPreset(v)
  } else {
    preset.value = { ...preset.value, kind: 'custom' }
  }
}

/** 当前表单对应的调度。once 走 { type:'once' }，**绝不**经过 cron 构造。 */
function scheduleDto(): ScheduleDto | null {
  if (preset.value.kind === 'once') {
    if (!onceLocal.value) return null
    const runAt = new Date(onceLocal.value).getTime()
    return Number.isFinite(runAt) ? { type: 'once', runAt } : null
  }
  const expr = expression.value
  if (!expr) return null
  return { type: 'cron', expression: expr }
}

function fmt(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`
  return sameDay ? `今天 ${time}` : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`
}

// 预览是异步 IPC：用自增 token 丢弃过期响应，避免连打时旧结果覆盖新结果的 .bad / 禁用态
let previewToken = 0
async function refreshPreview() {
  const token = ++previewToken
  nextRuns.value = []
  exprError.value = ''
  const schedule = scheduleDto()
  if (!schedule) {
    // 还没填全（清空了数字 / 没选星期 / 自定义为空 / once 没选时间）：给出原因，别只留一个「—」
    exprError.value = preset.value.kind === 'once' ? '请选择运行时间' : '调度表达式不完整'
    return
  }
  const isOnce = schedule.type === 'once'
  try {
    const runs = await store.preview(schedule)
    if (token !== previewToken) return
    nextRuns.value = runs
    if (runs.length === 0) {
      exprError.value = isOnce ? '运行时间已过，请选择将来的时间' : '表达式无法解析出下一次运行时间'
    }
  } catch {
    if (token !== previewToken) return
    exprError.value = isOnce ? '运行时间不合法' : '表达式非法'
  }
}

function submit() {
  const schedule = scheduleDto()
  if (!schedule) return
  emit('submit', { name: name.value.trim(), prompt: prompt.value, schedule })
}

onMounted(() => {
  const raw = props.task?.scheduleRaw
  if (raw?.type === 'once') {
    const d = new Date(raw.runAt)
    const p = (n: number) => String(n).padStart(2, '0')
    onceLocal.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
    preset.value = { ...preset.value, kind: 'once' }
  } else if (raw?.type === 'cron') {
    applyExprToPreset(raw.expression)
  }
  void refreshPreview()
})

watch([preset, manualExpr, onceLocal], () => void refreshPreview(), { deep: true })
</script>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 200;
  display: flex; align-items: center; justify-content: center;
  padding: 32px; background: var(--scrim);
}
.dlg {
  width: 560px; max-width: 100%; max-height: 100%;
  display: flex; flex-direction: column;
  background: var(--bg-panel); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window); overflow: hidden;
}
.dlg-hd {
  display: flex; align-items: center; padding: 14px 18px;
  border-bottom: 1px solid var(--border); font-weight: 600;
  font-size: var(--fs-body); color: var(--text-primary);
}
.dlg-hd .x { margin-left: auto; color: var(--text-tertiary); cursor: pointer; display: flex; }
.dlg-hd .x:hover { color: var(--text-primary); }
.dlg-bd {
  padding: 18px; display: flex; flex-direction: column; gap: 16px;
  overflow-y: auto;
}
.fld { display: grid; grid-template-columns: 68px 1fr; gap: 10px; align-items: start; }
.fld > label { font-size: var(--fs-caption); color: var(--text-secondary); padding-top: 7px; }
.fld .ctl { display: flex; gap: 8px; min-width: 0; }
.fld .ctl.col { flex-direction: column; gap: 6px; }
.fld .ctl.col.wide { gap: 10px; }
.fld .ctl.center { align-items: center; }
.fld .ctl.wrap { flex-wrap: wrap; gap: 6px; }

.inp {
  flex: 1; min-width: 0;
  font-family: inherit; font-size: var(--fs-caption); padding: 5px 8px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-input); color: var(--text-primary); outline: none;
}
.inp::placeholder { color: var(--text-tertiary); }
.inp:focus { border-color: var(--border-focus); }
.inp:disabled { color: var(--text-tertiary); cursor: not-allowed; }
.inp.bad { border-color: var(--status-error); }
textarea.inp { resize: vertical; min-height: 68px; line-height: 1.55; width: 100%; }
.num { flex: none; width: 56px; text-align: center; }
/* 三个汉字 @12px = 36px，34px 会把「表达式」折成两行 */
.expr-label { width: 40px; flex: none; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dim { color: var(--text-tertiary); }
.small { font-size: var(--fs-caption); }

.radios { display: flex; flex-wrap: wrap; gap: 6px; }
.radio {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px;
  border: 1px solid var(--border); border-radius: var(--radius-pill);
  font-size: var(--fs-caption); color: var(--text-secondary); cursor: pointer;
  background: var(--bg-card); user-select: none;
}
.radio:hover { background: var(--bg-hover); }
.radio.on { border-color: var(--accent); background: var(--accent-soft-bg); color: var(--accent); font-weight: 500; }
.radio .dot2 {
  width: 11px; height: 11px; border-radius: 50%;
  border: 1.5px solid currentColor; flex: none;
}
.radio.on .dot2 { border-width: 3.5px; }

.preview {
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-input); padding: 10px 12px;
}
.preview .ph {
  font-size: 10px; letter-spacing: .6px; text-transform: uppercase;
  color: var(--text-tertiary); margin-bottom: 7px;
}
.preview .pl {
  display: flex; flex-wrap: wrap; gap: 18px;
  font-size: var(--fs-body-sm); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.hint {
  display: flex; gap: 6px; align-items: flex-start;
  font-size: 11px; color: var(--text-tertiary); line-height: 1.45;
}
.hint svg { margin-top: 2px; flex: none; }
.warn {
  display: flex; gap: 9px; padding: 10px 12px;
  background: var(--status-warn-bg); border: 1px solid var(--status-warn-border);
  border-radius: var(--radius-sm); font-size: var(--fs-caption);
  color: var(--text-primary); line-height: 1.45;
}
.warn svg { color: var(--status-warn); margin-top: 1px; flex: none; }
.dlg-ft {
  display: flex; justify-content: flex-end; gap: 8px; padding: 14px 18px;
  border-top: 1px solid var(--border); background: var(--bg-primary);
}
.btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 7px 16px;
  border-radius: var(--radius-sm); font-size: var(--fs-caption);
  border: 1px solid var(--border); background: var(--bg-card);
  color: var(--text-secondary); cursor: pointer; font-family: inherit;
}
.btn:hover { background: var(--bg-hover); }
.btn.primary { background: var(--accent); color: var(--text-inverse); border-color: transparent; }
.btn.primary:hover:not(:disabled) { background: var(--accent-deep); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
