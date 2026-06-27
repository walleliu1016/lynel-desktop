<template>
  <div class="cloud-tab">
    <div class="notice">
      <span class="badge">v1 占位</span>
      <span class="msg">云服务在 v1 暂未启用，配置项可保存但不会实际连接。</span>
    </div>

    <div class="row toggle">
      <label class="k">启用</label>
      <div class="v">
        <label class="switch">
          <input type="checkbox" v-model="cfg.cloud_service_enabled" @change="markDirty" />
          <span class="slider" />
        </label>
      </div>
    </div>

    <div class="row">
      <label class="k">服务地址</label>
      <input class="v" v-model="cfg.cloud_service_url" :disabled="!cfg.cloud_service_enabled" placeholder="https://ease.example.com" />
    </div>

    <div class="row">
      <label class="k">鉴权 Token</label>
      <input class="v" type="password" v-model="cfg.cloud_service_token" :disabled="!cfg.cloud_service_enabled" />
    </div>

    <div class="row">
      <label class="k">连接状态</label>
      <div class="v status">
        <span class="dot" />
        <span>未连接（v1 暂未启用）</span>
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
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const cfg = computed(() => settings.cfg as any)

onMounted(() => settings.load())
function markDirty() { settings.markDirty() }

async function onSave() {
  try { await settings.save() }
  catch (e: any) { alert('保存失败：' + (e?.message ?? e)) }
}

function onTest() {
  alert('v1 暂不支持测试连接')
}
</script>

<style scoped>
.cloud-tab { padding: 20px 24px; max-width: 600px; }
.notice {
  display: flex; gap: 10px; align-items: center;
  padding: 10px 14px; background: rgba(124,58,237,0.08);
  border: 1px solid var(--accent); border-radius: var(--radius-md);
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
.switch { position: relative; display: inline-block; width: 36px; height: 20px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; inset: 0; background: var(--border); border-radius: 10px; }
.slider::before { position: absolute; content: ''; height: 14px; width: 14px; left: 3px; top: 3px; background: white; border-radius: 50%; transition: 0.2s; }
.switch input:checked + .slider { background: var(--accent); }
.switch input:checked + .slider::before { transform: translateX(16px); }
.actions { display: flex; align-items: center; gap: 8px; margin-top: 24px; }
.test { padding: 6px 14px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 11px; }
.test:hover:not(:disabled) { background: var(--border); }
.spacer { flex: 1; }
.save { padding: 6px 16px; background: var(--accent); color: white; border-radius: var(--radius-md); }
.save:hover:not(:disabled) { background: var(--accent-light); }
.cancel { padding: 6px 16px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-md); }
.save:disabled, .cancel:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
