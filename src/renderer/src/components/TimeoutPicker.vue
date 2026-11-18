<!-- 超时选择器：预设档（15m/30m/1h/8h/24h）+ 自定义（数值 + 分钟/小时）。
     两处复用：设置 → 定时任务（无「默认」档）与任务表单（allowDefault，开头多一档「默认（跟随全局）」）。
     自定义越界（<1 分钟 / >7 天）就地报错且 update:valid=false，父级据此禁保存。
     单位回填规则：整小时用「小时」，否则「分钟」向上取整（与 spec §5.2 一致）。 -->
<template>
  <div class="tp">
    <div class="tp-row">
      <button
        v-if="allowDefault"
        class="radio"
        :class="{ on: mode === 'default' }"
        @click="pickDefault"
      >默认</button>
      <button
        v-for="p in PRESETS"
        :key="p.ms"
        class="radio"
        :class="{ on: mode === 'preset' && pickedMs === p.ms }"
        @click="pickPreset(p.ms)"
      >{{ p.label }}</button>
      <button class="radio" :class="{ on: mode === 'custom' }" @click="pickCustom">自定义</button>
    </div>
    <div v-if="mode === 'custom'" class="tp-custom">
      <input v-model.number="customValue" class="tp-num" type="number" min="1" @input="emitCustom" />
      <select v-model="customUnit" class="tp-unit" @change="emitCustom">
        <option value="minute">分钟</option>
        <option value="hour">小时</option>
      </select>
      <span v-if="!customValid" class="tp-warn">范围 1 分钟 ~ 7 天</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  /** 毫秒。null = 跟随全局（仅 allowDefault 时会出现） */
  modelValue: number | null
  /** 是否提供「默认（跟随全局）」档 */
  allowDefault?: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: number | null): void
  (e: 'update:valid', v: boolean): void
}>()

const MIN_MS = 60_000
const MAX_MS = 7 * 24 * 60 * 60 * 1000
const PRESETS = [
  { ms: 15 * 60_000, label: '15m' },
  { ms: 30 * 60_000, label: '30m' },
  { ms: 60 * 60_000, label: '1h' },
  { ms: 8 * 60 * 60_000, label: '8h' },
  { ms: 24 * 60 * 60_000, label: '24h' },
]

type Mode = 'default' | 'preset' | 'custom'
const mode = ref<Mode>('default')
const pickedMs = ref<number | null>(null)
const customValue = ref(30)
const customUnit = ref<'minute' | 'hour'>('minute')

const customMs = computed(() => customValue.value * (customUnit.value === 'hour' ? 3600_000 : 60_000))
const customValid = computed(
  () => Number.isFinite(customMs.value) && customMs.value >= MIN_MS && customMs.value <= MAX_MS,
)

/** 最近一次写回的值：回声（父级把同值回传）不再触发 sync，避免打字中途被切成预设档 */
let lastSent: number | null | undefined = undefined

function syncFromProp(): void {
  const v = props.modelValue
  if (v == null) {
    mode.value = 'default'
    pickedMs.value = null
    return
  }
  const hit = PRESETS.find((p) => p.ms === v)
  if (hit) {
    mode.value = 'preset'
    pickedMs.value = hit.ms
    return
  }
  mode.value = 'custom'
  pickedMs.value = null
  if (v % 3600_000 === 0) {
    customUnit.value = 'hour'
    customValue.value = v / 3600_000
  } else {
    customUnit.value = 'minute'
    customValue.value = Math.ceil(v / 60_000)
  }
}

onMounted(syncFromProp)
watch(() => props.modelValue, (v) => {
  if (v === lastSent) return
  syncFromProp()
})

function pickDefault(): void {
  mode.value = 'default'
  pickedMs.value = null
  lastSent = null
  emit('update:modelValue', null)
  emit('update:valid', true)
}

function pickPreset(ms: number): void {
  mode.value = 'preset'
  pickedMs.value = ms
  lastSent = ms
  emit('update:modelValue', ms)
  emit('update:valid', true)
}

function pickCustom(): void {
  mode.value = 'custom'
  pickedMs.value = null
  emitCustom()
}

function emitCustom(): void {
  if (!customValid.value) {
    emit('update:valid', false)
    return
  }
  lastSent = customMs.value
  emit('update:valid', true)
  emit('update:modelValue', customMs.value)
}
</script>

<style scoped>
.tp { display: flex; flex-direction: column; gap: 8px; }
.tp-row { display: flex; flex-wrap: wrap; gap: 6px; }
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
.tp-custom { display: flex; align-items: center; gap: 8px; }
.tp-num {
  width: 72px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--fs-caption);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.tp-unit {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--fs-caption);
  font-family: inherit;
}
.tp-warn { font-size: 11px; color: var(--status-error); }
</style>
