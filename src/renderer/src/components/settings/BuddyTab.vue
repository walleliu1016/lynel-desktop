<template>
  <div class="buddy-tab">
    <div class="actions">
      <div class="spacer" />
      <button class="btn-cancel" :disabled="!settings.dirty" @click="settings.load">取消</button>
      <button class="btn-save" :disabled="!settings.dirty" @click="onSave">保存</button>
    </div>

    <!-- 实时预览：顶部紧凑横排卡（宠物 + 属性条并排） -->
    <div class="preview">
      <div class="preview-head">
        <span class="preview-badge" :style="{ color: rarityColor }">{{ RARITY_STARS[rarity] }} {{ rarity }}</span>
        <span class="preview-name" :style="{ color: rarityColor }">{{ species.name }}</span>
        <span class="face-text">表情 {{ faceText }}</span>
        <span v-if="buddyShiny" class="shiny-badge">SHINY</span>
      </div>
      <div class="preview-body">
        <div class="preview-stage" :style="{ borderColor: rarityColor + '66' }">
          <BuddyPet
            :species="species"
            :eye="buddyEye"
            :hat="buddyHat"
            :shiny="buddyShiny"
            :tilt="buddy3DTilt"
            :float-amp="buddyFloatAmp"
            :custom-frames="previewFrames"
            :stats="previewStats"
          />
        </div>
        <div class="preview-stats">
          <div v-for="row in statRows" :key="row.key" class="stat-row">
            <span class="stat-label">{{ row.label }}</span>
            <div class="stat-bar">
              <div class="stat-fill" :style="{ width: row.value + '%', background: row.color }" />
            </div>
            <span class="stat-val">{{ row.value }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 紧凑表单：两列网格，行内标签，控件贴内容宽度 -->
    <div class="fields">
      <div class="field">
        <span class="flabel">启用</span>
        <Switch v-model="buddyEnabled" />
      </div>

      <div class="field">
        <span class="flabel">Shiny</span>
        <Switch v-model="buddyShiny" />
      </div>

      <div class="field">
        <span class="flabel">物种</span>
        <div class="select-wrap">
          <Select v-model="buddyRoleId" :options="speciesOptions" />
        </div>
      </div>

      <div class="field">
        <span class="flabel">帽子</span>
        <div class="select-wrap">
          <Select v-model="buddyHat" :options="hatOptions" />
        </div>
      </div>

      <div class="field">
        <span class="flabel">眼睛</span>
        <div class="eye-row">
          <button
            v-for="e in BUDDY_EYES"
            :key="e"
            class="eye-btn"
            :class="{ active: buddyEye === e }"
            @click="buddyEye = e"
          >{{ e }}</button>
        </div>
      </div>

      <div class="field">
        <span class="flabel">稀有度</span>
        <div class="select-wrap">
          <Select v-model="raritySelect" :options="rarityOptions" />
        </div>
      </div>

      <div class="field">
        <span class="flabel">3D 旋转</span>
        <div class="range-ctrl">
          <input type="range" min="0" max="20" step="1" v-model.number="buddy3DTilt" />
          <span class="form-value">{{ buddy3DTilt }}°</span>
        </div>
      </div>

      <div class="field">
        <span class="flabel">浮动</span>
        <div class="range-ctrl">
          <input type="range" min="0" max="10" step="1" v-model.number="buddyFloatAmp" />
          <span class="form-value">{{ buddyFloatAmp }}px</span>
        </div>
      </div>

      <div class="field wide">
        <span class="flabel">自定义</span>
        <textarea
          v-model="buddyCustomAscii"
          rows="2"
          class="buddy-textarea"
          placeholder="粘贴自定义 ASCII，最多 40 行 × 80 列"
        />
        <span v-if="asciiError" class="ascii-error">{{ asciiError }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Switch from '../Switch.vue'
import Select from '../Select.vue'
import BuddyPet from '../buddy/BuddyPet.vue'
import { useSettingsStore } from '../../stores/settings'
import { BUDDY_SPECIES, getBuddySpecies } from '../../data/buddies/presets'
import { BUDDY_EYES, HAT_OPTIONS, getFace } from '../../data/buddies/appearance'
import { RARITIES, RARITY_STARS, RARITY_COLORS, STAT_COLORS, rollSpeciesStats } from '../../data/buddies/rarity'
import { applyCustomAscii, validateCustomAscii } from '../../data/buddies/validate'
import { BUDDY_STAT_KEYS } from '../../data/buddies/types'
import type { BuddyRarity } from '../../data/buddies/types'
import { pushToast } from '../../composables/useToast'

const settings = useSettingsStore()

/**
 * 直接响应式绑定 settings.cfg：v-model 改字段即 markDirty，
 * 取消走 settings.load()（替换 cfg 引用）后 computed 自动回退到持久化值，无需本地镜像 ref。
 */
const buddyEnabled = computed({
  get: () => settings.cfg?.buddyEnabled ?? false,
  set: (v: boolean) => { if (settings.cfg) settings.cfg.buddyEnabled = v; settings.markDirty() },
})
const buddyRoleId = computed({
  get: () => settings.cfg?.buddyRoleId ?? 'duck',
  set: (v: string) => { if (settings.cfg) settings.cfg.buddyRoleId = v; settings.markDirty() },
})
const buddyEye = computed({
  get: () => settings.cfg?.buddyEye ?? '·',
  set: (v) => { if (settings.cfg) settings.cfg.buddyEye = v; settings.markDirty() },
})
const buddyHat = computed({
  get: () => settings.cfg?.buddyHat ?? 'none',
  set: (v) => { if (settings.cfg) settings.cfg.buddyHat = v; settings.markDirty() },
})
const buddyShiny = computed({
  get: () => settings.cfg?.buddyShiny ?? false,
  set: (v: boolean) => { if (settings.cfg) settings.cfg.buddyShiny = v; settings.markDirty() },
})
const buddyRarity = computed<BuddyRarity | null>({
  get: () => settings.cfg?.buddyRarity ?? null,
  set: (v) => { if (settings.cfg) settings.cfg.buddyRarity = v; settings.markDirty() },
})
const buddy3DTilt = computed({
  get: () => settings.cfg?.buddy3DTilt ?? 8,
  set: (v: number) => { if (settings.cfg) settings.cfg.buddy3DTilt = v; settings.markDirty() },
})
const buddyFloatAmp = computed({
  get: () => settings.cfg?.buddyFloatAmp ?? 3,
  set: (v: number) => { if (settings.cfg) settings.cfg.buddyFloatAmp = v; settings.markDirty() },
})
const buddyCustomAscii = computed({
  get: () => settings.cfg?.buddyCustomAscii ?? '',
  set: (v: string) => { if (settings.cfg) settings.cfg.buddyCustomAscii = v; settings.markDirty() },
})

/** 预览物种 + 稀有度：用户显式选择优先，否则用物种固有 */
const species = computed(() => getBuddySpecies(buddyRoleId.value))
const rarity = computed<BuddyRarity>(() => settings.cfg?.buddyRarity ?? species.value.rarity)

/** 稀有度下拉：空串代表「跟随物种」（映射回 null），避免 SelectOption.value 非 string 问题 */
const raritySelect = computed({
  get: () => settings.cfg?.buddyRarity ?? '',
  set: (v: string) => {
    if (settings.cfg) settings.cfg.buddyRarity = (v || null) as BuddyRarity | null
    settings.markDirty()
  },
})
const rarityOptions = [
  { value: '', label: '跟随物种' },
  ...RARITIES.map((r) => ({ value: r, label: `${RARITY_STARS[r]} ${r}` })),
]

/** 预览属性：稀有度驱动（确定性 seed），体现稀有度下限与 peak/dump 性格 */
const previewStats = computed(() => rollSpeciesStats(species.value, rarity.value))
/** 自定义 ASCII 覆盖：合法时完全替换基座渲染帧 */
const previewFrames = computed(() => applyCustomAscii(settings.cfg?.buddyCustomAscii || '') ?? undefined)

/** 校验提示：空值（默认/持久化为空）不报错，仅对非空内容校验 */
const asciiError = computed(() => {
  const v = settings.cfg?.buddyCustomAscii || ''
  if (!v) return ''
  const r = validateCustomAscii(v)
  return r.ok ? '' : r.error
})

const faceText = computed(() => getFace(species.value.id, buddyEye.value))
const rarityColor = computed(() => RARITY_COLORS[rarity.value])

const speciesOptions = BUDDY_SPECIES.map((s) => ({
  value: s.id,
  label: `${s.name} · ${RARITY_STARS[s.rarity]} ${s.rarity}`,
}))
const hatOptions = HAT_OPTIONS.map((h) => ({ value: h.value, label: h.art ? `${h.label} ${h.art}` : h.label }))

const statRows = computed(() =>
  BUDDY_STAT_KEYS.map((k) => ({
    key: k,
    label: k.toUpperCase(),
    value: previewStats.value[k],
    color: STAT_COLORS[k],
  })),
)

onMounted(async () => {
  if (!settings.cfg) await settings.load()
})

async function onSave() {
  try {
    await settings.save()
    pushToast({ level: 'info', source: 'settings', message: '保存成功' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'settings', message: '保存失败：' + (e?.message ?? e) })
  }
}
</script>

<style scoped>
.buddy-tab { padding: 8px 16px 14px; }

.actions {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border);
}
.spacer { flex: 1; }
.btn-save { padding: 6px 18px; background: var(--accent); color: var(--text-inverse); border: none; border-radius: var(--radius-md); font-size: 12px; font-weight: 500; cursor: pointer; }
.btn-save:hover:not(:disabled) { background: var(--accent-deep); }
.btn-cancel { padding: 6px 14px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }
.btn-cancel:hover:not(:disabled) { background: var(--border); }
.btn-save:disabled, .btn-cancel:disabled { opacity: 0.4; cursor: not-allowed; }

/* 顶部预览卡：紧凑横排，宠物 + 属性条并排 */
.preview {
  margin-bottom: 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}
.preview-head {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  margin-bottom: 6px;
}
.preview-badge { font-size: 13px; font-weight: 600; }
.preview-name { font-size: 14px; font-weight: 600; }
.face-text { font-size: 11px; color: var(--text-tertiary); }
.shiny-badge { color: #e3b341; font-size: 10px; margin-left: auto; }

.preview-body { display: flex; gap: 16px; align-items: center; }
.preview-stage {
  flex: 1 1 auto; min-height: 112px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 10px;
  transition: border-color 0.2s;
}
.preview-stage :deep(.buddy) { transform-origin: center; }
/* 预览内宠物放大到 18px，填满大舞台 */
.preview-stage :deep(.buddy-pre) { font-size: 18px; }
.preview-stats { flex: 0 0 210px; min-width: 0; }

.stat-row { display: flex; align-items: center; gap: 6px; margin-bottom: 1px; font-size: 11px; line-height: 1.2; }
.stat-label { min-width: 58px; color: var(--text-secondary); font-weight: 500; }
.stat-bar { flex: 1; height: 7px; background: var(--border); border-radius: 3px; overflow: hidden; }
.stat-fill { height: 100%; border-radius: 3px; transition: width 0.2s; }
.stat-val { min-width: 20px; text-align: right; color: var(--text-secondary); font-family: var(--font-mono); }

/* 紧凑表单：两列网格，行内标签 */
.fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px 16px;
  align-items: center;
}
.field { display: flex; align-items: center; gap: 8px; min-width: 0; }
.field.wide { grid-column: 1 / -1; }
.flabel { flex: 0 0 auto; width: 46px; font-size: 12px; color: var(--text-secondary); }

/* 下拉：fit-content 贴内容宽度，避免满宽空档 */
.select-wrap { width: fit-content; }
.select-wrap :deep(.lynel-select) { width: 100%; }

.eye-row { flex: 1; display: flex; gap: 4px; min-width: 0; }
.eye-btn {
  flex: 1; min-width: 0; padding: 4px 0;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.eye-btn:hover { background: var(--bg-hover); }
.eye-btn.active {
  background: var(--accent-soft-bg);
  border-color: var(--accent);
  color: var(--accent-light);
}

.range-ctrl { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0; }
.range-ctrl input { flex: 1; min-width: 0; accent-color: var(--accent); }
.form-value { font-family: var(--font-mono); font-size: 12px; color: var(--text-primary); flex-shrink: 0; }

.buddy-textarea {
  flex: 1; min-width: 0;
  min-height: 46px;
  padding: 6px 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-mono, ui-monospace, 'SF Mono', Menlo, Consolas, monospace);
  font-size: 12px;
  line-height: 1.3;
  resize: vertical;
  box-sizing: border-box;
}
.buddy-textarea:focus { border-color: var(--accent); outline: none; }
.ascii-error { font-size: 11px; color: var(--status-error); flex-shrink: 0; }
</style>
