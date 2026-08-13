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
          <label class="form-label">角色</label>
          <Select v-model="buddyRoleId" :options="buddyRoleOptions" />
        </div>

        <div class="form-group">
          <label class="form-label">自定义 ASCII（选填，粘贴即覆盖角色画）</label>
          <textarea
            v-model="buddyCustomAscii"
            rows="7"
            class="buddy-textarea"
            placeholder="粘贴自定义 ASCII 字符画，最多 40 行 × 80 列"
          />
          <p class="form-hint">留空使用所选角色自带图案；行首空格会保留以保证构图。</p>
          <p v-if="asciiError" class="form-hint ascii-error">{{ asciiError }}</p>
        </div>
      </div>

      <!-- 实时预览区 -->
      <div class="preview">
        <div class="preview-title">实时预览</div>
        <div class="preview-stage">
          <BuddyPet :role="previewRole" :stats="previewStats" />
        </div>
        <p class="form-hint">预览可交互：hover 立体倾斜、点击出吐槽气泡；角色或 ASCII 变更即时生效。</p>
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
import { BUDDY_ROLES, getBuddyRole } from '../../data/buddies/presets'
import { applyCustomAscii, validateCustomAscii } from '../../data/buddies/validate'
import { createStats } from '../../data/buddies/buddyStats'
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
const buddyCustomAscii = computed({
  get: () => settings.cfg?.buddyCustomAscii ?? '',
  set: (v: string) => { if (settings.cfg) settings.cfg.buddyCustomAscii = v; settings.markDirty() },
})

/** 校验提示：空值（默认/持久化为空）不报错，仅对非空内容校验 */
const asciiError = computed(() => {
  const v = settings.cfg?.buddyCustomAscii || ''
  if (!v) return ''
  const r = validateCustomAscii(v)
  return r.ok ? '' : r.error
})

/** 预览角色：当前选中角色 + 合法自定义 ASCII 覆盖（含首尾空行剔除） */
const baseRole = computed(() => getBuddyRole(buddyRoleId.value))
const previewRole = computed(() => applyCustomAscii(baseRole.value, settings.cfg?.buddyCustomAscii || ''))
/** 预览属性：从角色基线起步，让预览体现实力的性格倾向 */
const previewStats = computed(() => createStats(previewRole.value.baseline))

const buddyRoleOptions = BUDDY_ROLES.map((r) => ({ value: r.id, label: `${r.name} · ${r.rarity}` }))

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
.buddy-tab { padding: 20px 24px; max-width: 760px; }
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
  margin-bottom: 12px;
}
.preview-stage {
  display: flex; align-items: center; justify-content: center;
  min-height: 160px;
  background: var(--bg-panel);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
}
.preview-stage :deep(.buddy) { transform-origin: center; }

.form-group { margin-bottom: 18px; }
.form-label {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500;
}
.form-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; line-height: 1.5; }
.ascii-error { color: var(--status-error); }

.switch-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: var(--radius-md); cursor: pointer;
}
.switch-row:hover { background: var(--bg-input); }
.switch-label { font-size: 13px; color: var(--text-primary); }

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
