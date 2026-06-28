<template>
  <div class="general-tab">
    <div class="row">
      <label class="k">主题</label>
      <select class="v" v-model="cfg.theme" @change="markDirty">
        <option value="dark-pro">深色专业</option>
      </select>
    </div>

    <div class="row">
      <label class="k">Claude CLI 路径</label>
      <input class="v" v-model="cfg.claude_path" @change="markDirty" placeholder="留空用 PATH 中的 claude" />
    </div>

    <div class="row toggle">
      <label class="k">自动允许命令执行</label>
      <div class="v">
        <label class="switch">
          <input type="checkbox" v-model="cfg.auto_allow_bash" @change="markDirty" />
          <span class="slider" />
        </label>
        <p class="hint">⚠ 仅对 Bash 工具生效；其他工具仍需手动确认。App 内静默放行，不修改 Claude settings。</p>
      </div>
    </div>

    <div class="row toggle">
      <label class="k">日志</label>
      <div class="v">
        <label class="switch">
          <input type="checkbox" v-model="cfg.log_enabled" @change="markDirty" />
          <span class="slider" />
        </label>
        <p class="hint">启用后 Claude CLI 的原始输出会写入 ~/.ease-ui/logs/sessions/&lt;sid&gt;.log</p>
      </div>
    </div>

    <div class="row">
      <label class="k">自动锁定</label>
      <select class="v" v-model.number="cfg.auto_lock_minutes" @change="markDirty">
        <option :value="1">1 分钟</option>
        <option :value="5">5 分钟</option>
        <option :value="10">10 分钟</option>
        <option :value="30">30 分钟</option>
        <option :value="60">60 分钟</option>
        <option :value="0">关闭</option>
      </select>
    </div>

    <div class="row toggle">
      <label class="k">启动时自启</label>
      <div class="v">
        <label class="switch">
          <input type="checkbox" v-model="cfg.auto_start" @change="markDirty" />
          <span class="slider" />
        </label>
      </div>
    </div>

    <div class="row toggle">
      <label class="k">启动时最小化</label>
      <div class="v">
        <label class="switch">
          <input type="checkbox" v-model="cfg.minimize_on_start" @change="markDirty" />
          <span class="slider" />
        </label>
      </div>
    </div>

    <div class="actions">
      <button class="danger" @click="onClear">清除账户密码</button>
      <div class="spacer" />
      <button class="cancel" :disabled="!settings.dirty" @click="settings.load">取消</button>
      <button class="save" :disabled="!settings.dirty" @click="onSave">保存</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useSettingsStore } from '../../stores/settings'
import { ClearPassword } from '../../composables/useWails'

const settings = useSettingsStore()
const cfg = computed(() => settings.cfg ?? (settings.cfg = {
  theme: 'dark-pro',
  claude_path: '',
  auto_allow_bash: false,
  log_enabled: false,
  auto_lock_minutes: 5,
  auto_start: false,
  minimize_on_start: false,
  cloud_service_enabled: false,
  cloud_service_url: '',
  cloud_service_token: '',
} as any))

onMounted(() => settings.load())
function markDirty() { settings.markDirty() }

async function onSave() {
  try { await settings.save() }
  catch (e: any) { alert('保存失败：' + (e?.message ?? e)) }
}

async function onClear() {
  if (!confirm('清除账户密码后下次启动会进入「未初始化」状态。继续？')) return
  try { await ClearPassword() }
  catch (e: any) { alert('清除失败：' + (e?.message ?? e)) }
}
</script>

<style scoped>
.general-tab { padding: 20px 24px; max-width: 600px; }
.row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
.k { width: 140px; font-size: 12px; color: var(--text-primary); padding-top: 6px; }
.v { flex: 1; }
.v > input, .v > select {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 6px 10px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
}
.v > input:focus, .v > select:focus { outline: none; border-color: var(--accent); }
.hint { font-size: 10px; color: var(--text-tertiary); margin-top: 4px; line-height: 1.4; }
.toggle .v { display: flex; flex-direction: column; gap: 4px; }
.switch { position: relative; display: inline-block; width: 36px; height: 20px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; inset: 0; background: var(--border); border-radius: 10px; transition: 0.2s; }
.slider::before { position: absolute; content: ''; height: 14px; width: 14px; left: 3px; top: 3px; background: white; border-radius: 50%; transition: 0.2s; }
.switch input:checked + .slider { background: var(--accent); }
.switch input:checked + .slider::before { transform: translateX(16px); }
.actions { display: flex; align-items: center; gap: 8px; margin-top: 24px; }
.danger { padding: 6px 14px; background: var(--bg-input); border: 1px solid var(--status-error); color: var(--status-error); border-radius: var(--radius-md); font-size: 11px; }
.danger:hover { background: var(--status-error); color: white; }
.spacer { flex: 1; }
.save { padding: 6px 16px; background: var(--accent); color: white; border-radius: var(--radius-md); }
.save:hover:not(:disabled) { background: var(--accent-light); }
.cancel { padding: 6px 16px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-md); }
.save:disabled, .cancel:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
