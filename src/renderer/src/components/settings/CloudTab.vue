<template>
  <div class="cloud-tab">
    <div class="row toggle">
      <label class="k">启用</label>
      <div class="v">
        <Switch v-model="cfg.cloud_service_enabled" @change="markDirty" />
      </div>
    </div>

    <div class="row">
      <label class="k">服务地址</label>
      <input class="v" v-model="cfg.cloud_service_url" @change="markDirty" :disabled="!cfg.cloud_service_enabled" placeholder="https://ease.example.com" />
    </div>

    <div class="row">
      <label class="k">鉴权 Token</label>
      <input class="v" type="password" v-model="cfg.cloud_service_token" @change="markDirty" :disabled="!cfg.cloud_service_enabled" />
    </div>

    <div class="row">
      <label class="k">连接状态</label>
      <div class="v status">
        <span class="dot" />
        <span>{{ cfg.cloud_service_enabled ? '未连接' : '未启用' }}</span>
      </div>
    </div>

    <div class="actions">
      <button class="test" :disabled="!cfg.cloud_service_enabled" @click="onTest">测试连接</button>
      <div class="spacer" />
      <button class="cancel" :disabled="!settings.dirty" @click="settings.load">取消</button>
      <button class="save" :disabled="!settings.dirty" @click="onSave">保存</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import Switch from '../../components/Switch.vue'
import { useSettingsStore } from '../../stores/settings'

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

function onTest() {
  // 云服务连接测试暂未开放
}
</script>

<style scoped>
.cloud-tab { padding: 20px 24px; max-width: 600px; }
.notice {
  display: flex; gap: 10px; align-items: center;
  padding: 10px 14px; background: var(--accent-soft-bg);
  border: 1px solid var(--accent-soft-border); border-radius: var(--radius-md);
  margin-bottom: 20px; font-size: 12px;
}
.badge {
  background: var(--accent); color: white;
  padding: 2px 8px; border-radius: var(--radius-sm); font-size: 10px; font-weight: 600;
}
.row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
.k { width: 140px; font-size: 12px; color: var(--text-primary); padding-top: 6px; }
.v { flex: 1; }
.v > input, .v > select {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 6px 10px;
  color: var(--text-primary); font-size: 12px; font-family: inherit;
}
.v > input:disabled, .v > select:disabled { opacity: 0.5; }
.v > input:focus, .v > select:focus { outline: none; border-color: var(--accent); }
.status { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-tertiary); padding: 6px 0; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-tertiary); }
.toggle .v { display: flex; }
.actions { display: flex; align-items: center; gap: 8px; margin-top: 24px; }
.test { padding: 6px 14px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 11px; }
.test:hover:not(:disabled) { background: var(--border); }
.spacer { flex: 1; }
.save { padding: 6px 16px; background: var(--accent); color: white; border-radius: var(--radius-md); }
.save:hover:not(:disabled) { background: var(--accent-light); }
.cancel { padding: 6px 16px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-md); }
.save:disabled, .cancel:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
