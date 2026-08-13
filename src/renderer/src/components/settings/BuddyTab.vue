<template>
  <div class="buddy-tab">
    <h2>Buddy 电子宠物</h2>

    <div class="actions">
      <div class="spacer" />
      <button class="btn-cancel" :disabled="!settings.dirty" @click="settings.load">取消</button>
      <button class="btn-save" :disabled="!settings.dirty" @click="onSave">保存</button>
    </div>

    <div class="buddy-layout">
      <!-- 设计区 -->
      <div class="design">
        <div class="form-group">
          <label class="switch-row">
            <span class="switch-label">启用 Buddy 陪伴</span>
            <Switch v-model="buddyEnabled" />
          </label>
          <p class="form-hint">开启后出现在欢迎页角落与会话等待场景。</p>
        </div>

        <div class="form-group">
          <label class="form-label">物种（18 种）</label>
          <Select v-model="buddyRoleId" :options="speciesOptions" />
        </div>

        <div class="form-group">
          <label class="form-label">眼睛</label>
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

        <div class="form-group">
          <label class="form-label">帽子</label>
          <Select v-model="buddyHat" :options="hatOptions" />
        </div>

        <div class="form-group">
          <label class="form-label">稀有度（决定属性下限）</label>
          <div class="seg-group">
            <button
              class="seg"
              :class="{ active: buddyRarity === null }"
              @click="buddyRarity = null"
            >跟随物种</button>
            <button
              v-for="r in RARITIES"
              :key="r"
              class="seg"
              :class="{ active: buddyRarity === r }"
              @click="buddyRarity = r"
            >{{ RARITY_STARS[r] }} {{ r }}</button>
          </div>
        </div>

        <div class="form-group">
          <label class="switch-row">
            <span class="switch-label">Shiny <span class="shiny-star">✦</span></span>
            <Switch v-model="buddyShiny" />
          </label>
          <p class="form-hint">金色外观 + 光晕特效。</p>
        </div>

        <div class="form-group">
          <label class="form-label">
            3D 旋转角度
            <span class="form-value">{{ buddy3DTilt }}°</span>
          </label>
          <input type="range" min="0" max="20" step="1" v-model.number="buddy3DTilt" />
          <p class="form-hint">hover 立体倾斜幅度；0 关闭 3D 旋转。</p>
        </div>

        <div class="form-group">
          <label class="form-label">
            呼吸浮动
            <span class="form-value">{{ buddyFloatAmp }}px</span>
          </label>
          <input type="range" min="0" max="10" step="1" v-model.number="buddyFloatAmp" />
          <p class="form-hint">呼吸上下浮动幅度；0 静止。</p>
        </div>

        <div class="form-group">
          <label class="form-label">自定义 ASCII（选填，粘贴即覆盖宠物画）</label>
          <textarea
            v-model="buddyCustomAscii"
            rows="7"
            class="buddy-textarea"
            placeholder="粘贴自定义 ASCII 字符画，最多 40 行 × 80 列"
          />
          <p class="form-hint">留空使用所选物种自带图案；行首空格会保留以保证构图。</p>
          <p v-if="asciiError" class="form-hint ascii-error">{{ asciiError }}</p>
        </div>
      </div>

      <!-- 实时预览区 -->
      <div class="preview">
        <div class="preview-title">实时预览</div>
        <div class="preview-badge" :style="{ color: rarityColor }">
          <span>{{ RARITY_STARS[rarity] }} {{ rarity }}</span>
          <span v-if="buddyShiny" class="shiny-badge">✦ SHINY</span>
        </div>
        <div class="preview-name" :style="{ color: rarityColor }">
          {{ species.name }}<span class="face-text"> · 表情 {{ faceText }}</span>
        </div>
        <div class="preview-stage">
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
        <p class="form-hint">预览可交互：hover 立体倾斜、点击出吐槽气泡；所有配置变更即时生效。</p>
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
import { RARITIES, RARITY_STARS, RARITY_COLORS, RARITY_WEIGHTS, STAT_COLORS, rollSpeciesStats } from '../../data/buddies/rarity'
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
.buddy-tab { padding: 20px 24px; max-width: 780px; }
h2 { font-size: 16px; color: var(--text-primary); font-weight: 600; margin-bottom: 8px; }

.buddy-layout { display: flex; gap: 24px; align-items: flex-start; margin-top: 20px; }
.design { flex: 1 1 0; min-width: 0; }

.preview {
  flex: 1 1 0; min-width: 0;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px;
}
.preview-title {
  font-size: 12px; font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.04em;
  margin-bottom: 10px;
}
.preview-badge { font-size: 12px; font-weight: 600; margin-bottom: 2px; }
.preview-name { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.face-text { font-size: 11px; font-weight: 400; color: var(--text-tertiary); }
.shiny-badge { color: #e3b341; margin-left: 6px; font-size: 11px; }
.preview-stage {
  display: flex; align-items: center; justify-content: center;
  min-height: 150px;
  background: var(--bg-panel);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
}
.preview-stage :deep(.buddy) { transform-origin: center; }
.preview-stats { margin-top: 14px; }

.stat-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 11px; }
.stat-label { min-width: 64px; color: var(--text-secondary); font-weight: 500; }
.stat-bar { flex: 1; height: 8px; background: var(--border); border-radius: 3px; overflow: hidden; }
.stat-fill { height: 100%; border-radius: 3px; transition: width 0.2s; }
.stat-val { min-width: 24px; text-align: right; color: var(--text-secondary); font-family: var(--font-mono); }

.form-group { margin-bottom: 18px; }
.form-label {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500;
}
.form-value { font-family: var(--font-mono); color: var(--text-primary); font-size: 12px; }
.form-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; line-height: 1.5; }
.ascii-error { color: var(--status-error); }

.switch-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: var(--radius-md); cursor: pointer;
}
.switch-row:hover { background: var(--bg-input); }
.switch-label { font-size: 13px; color: var(--text-primary); }
.shiny-star { color: #e3b341; font-size: 12px; }

.eye-row { display: flex; gap: 6px; }
.eye-btn {
  flex: 1;
  min-width: 0;
  padding: 6px 0;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.eye-btn:hover { background: var(--bg-hover); }
.eye-btn.active {
  background: var(--accent-soft-bg);
  border-color: var(--accent);
  color: var(--accent-light);
}

.seg-group {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.seg {
  padding: 5px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.seg:hover { color: var(--text-primary); }
.seg.active {
  background: var(--accent-soft-bg);
  border-color: var(--accent);
  color: var(--accent-light);
  font-weight: 500;
}

input[type="range"] { width: 100%; accent-color: var(--accent); }

.buddy-textarea {
  width: 100%;
  min-height: 120px;
  padding: 8px 10px;
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

.actions {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px; padding-bottom: 16px; border-bottom: 1px solid var(--border);
}
.spacer { flex: 1; }
.btn-save { padding: 7px 20px; background: var(--accent); color: var(--text-inverse); border: none; border-radius: var(--radius-md); font-size: 12px; font-weight: 500; cursor: pointer; }
.btn-save:hover:not(:disabled) { background: var(--accent-deep); }
.btn-cancel { padding: 7px 16px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }
.btn-cancel:hover:not(:disabled) { background: var(--border); }
.btn-save:disabled, .btn-cancel:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
