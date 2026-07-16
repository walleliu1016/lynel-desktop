<template>
  <div class="general-tab">
    <h2>通用设置</h2>

    <div class="form-group">
      <label class="form-label">主题</label>
      <select class="form-select" v-model="cfg.theme" @change="onThemeChange">
        <option value="dark-pro">深色专业</option>
        <option value="light-pro">浅色（红蓝）</option>
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">Claude CLI 路径</label>
      <input class="form-input" v-model="cfg.claude_path" @change="markDirty" placeholder="留空使用 PATH 中的 claude" />
      <p class="form-hint">自定义 Claude 可执行文件路径。留空则自动查找 PATH。</p>
    </div>

    <div class="form-group">
      <label class="form-label">自动锁定</label>
      <select class="form-select" v-model.number="cfg.auto_lock_minutes" @change="markDirty">
        <option :value="1">1 分钟</option>
        <option :value="5">5 分钟</option>
        <option :value="10">10 分钟</option>
        <option :value="30">30 分钟</option>
        <option :value="60">60 分钟</option>
        <option :value="0">关闭</option>
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">开关</label>
      <div class="switch-list">
        <label class="switch-row">
          <span class="switch-label">自动允许 Bash 执行</span>
          <Switch v-model="cfg.auto_allow_bash" @change="markDirty" />
        </label>
        <label class="switch-row">
          <span class="switch-label">启用日志</span>
          <Switch v-model="cfg.log_enabled" @change="markDirty" />
        </label>
        <label class="switch-row">
          <span class="switch-label">启动时自启</span>
          <Switch v-model="cfg.auto_start" @change="markDirty" />
        </label>
        <label class="switch-row">
          <span class="switch-label">启动时最小化</span>
          <Switch v-model="cfg.minimize_on_start" @change="markDirty" />
        </label>
        <label class="switch-row">
          <span class="switch-label">显示灵动岛</span>
          <Switch v-model="cfg.notch_enabled" @change="markDirty" />
        </label>
      </div>
    </div>

    <div class="actions">
      <button class="btn-danger" @click="onClear">清除账户密码</button>
      <div class="spacer" />
      <button class="btn-cancel" :disabled="!settings.dirty" @click="settings.load">取消</button>
      <button class="btn-save" :disabled="!settings.dirty" @click="onSave">保存</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import Switch from '../../components/Switch.vue'
import { useSettingsStore } from '../../stores/settings'
import { ClearPassword } from '../../composables/useElectron'
import { showToast } from '../../composables/useToast'

const settings = useSettingsStore()
const cfg = computed(() => settings.cfg ?? (settings.cfg = {
  theme: 'light-pro',
  claude_path: '',
  auto_allow_bash: false,
  log_enabled: false,
  auto_lock_minutes: 5,
  auto_start: false,
  minimize_on_start: false,
  notch_enabled: true,
  cloud_service_enabled: false,
  cloud_service_url: '',
  cloud_service_token: '',
} as any))

onMounted(() => settings.load())
function markDirty() { settings.markDirty() }

function onThemeChange() {
  markDirty()
  const theme = cfg.value?.theme
  if (theme) {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('lynel-desktop-theme', theme)
  }
}

async function onSave() {
  try {
    await settings.save()
    showToast('保存成功')
  } catch (e: any) {
    showToast('保存失败：' + (e?.message ?? e), 'error')
  }
}

async function onClear() {
  if (!confirm('清除账户密码后下次启动会进入「未初始化」状态。继续？')) return
  try { await ClearPassword() }
  catch (e: any) { alert('清除失败：' + (e?.message ?? e)) }
}
</script>

<style scoped>
.general-tab { padding: 20px 24px; max-width: 560px; }
h2 { font-size: 16px; color: var(--text-primary); font-weight: 600; margin-bottom: 20px; }

.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
.form-input, .form-select {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: 13px; font-family: inherit;
}
.form-input:focus, .form-select:focus { outline: none; border-color: var(--accent); }
.form-input::placeholder { color: var(--text-tertiary); }
.form-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }

.switch-list { display: flex; flex-direction: column; gap: 2px; }
.switch-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: var(--radius-md); cursor: pointer;
}
.switch-row:hover { background: var(--bg-input); }
.switch-label { font-size: 13px; color: var(--text-primary); }

.actions { display: flex; align-items: center; gap: 8px; margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border); }
.btn-danger { padding: 7px 14px; background: none; border: 1px solid var(--status-error); color: var(--status-error); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }
.btn-danger:hover { background: var(--status-error); color: white; }
.spacer { flex: 1; }
.btn-save { padding: 7px 20px; background: var(--accent); color: white; border: none; border-radius: var(--radius-md); font-size: 12px; font-weight: 500; cursor: pointer; }
.btn-save:hover:not(:disabled) { background: var(--accent-deep); }
.btn-cancel { padding: 7px 16px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; }
.btn-cancel:hover:not(:disabled) { background: var(--border); }
.btn-save:disabled, .btn-cancel:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
