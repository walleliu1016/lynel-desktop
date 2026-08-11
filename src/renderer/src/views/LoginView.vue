<template>
  <div class="login">
    <TitleBar center hide-settings hide-cloud hide-logout />
    <div class="login-body">
      <div class="login-head">
        <div class="brand-row">
          <span class="brand-lynel">Lynel</span><span class="brand-desktop">Desktop</span>
        </div>
        <p class="login-tagline">多 Agent 编程终端，请求全程可视化，权限远程一键审批。</p>
      </div>

      <div class="login-card">
        <form @submit.prevent="onSubmit" class="form">
          <div class="form-group">
            <label class="form-label">用户名</label>
            <input
              class="form-input"
              :class="{ error: errorField === 'username' }"
              v-model="username"
              placeholder="UM账户"
              autocomplete="username"
            />
            <div class="form-hint">
              <template v-if="errorField === 'username'">{{ error }}</template>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">密码</label>
            <input
              class="form-input"
              :class="{ error: errorField === 'token' }"
              v-model="token"
              type="password"
              :placeholder="cloudEnabled ? 'PIN+Token' : '密码任意'"
              autocomplete="off"
            />
            <div class="form-hint">
              <template v-if="errorField === 'token'">{{ error }}</template>
            </div>
          </div>

          <div class="cloud-section">
            <div class="cloud-toggle-row">
              <Switch v-model="cloudEnabled" @change="onCloudToggle" />
              <span class="cloud-toggle-label">启用云服务<span class="cloud-beta-text">（测试阶段）</span></span>
              <span class="cloud-info-icon" data-tooltip="开启后，会话消息与权限请求将实时推送到移动 App，便于远程审批与查看进度">
                <Icon name="alert-circle" :size="14" />
              </span>
            </div>
            <div class="cloud-url-group" v-if="cloudEnabled">
              <label class="form-label">服务地址</label>
              <input
                class="form-input"
                v-model="cloudUrl"
                placeholder="https://ease.example.com"
              />
            </div>
          </div>

          <button class="login-btn" type="submit" :disabled="!canSubmit || loading">
            {{ loading ? '登录中...' : '登录' }}
          </button>
          <div class="login-footer">
            <span>Lynel Desktop v{{ version }}</span>
            <button class="footer-settings-btn" @click="goSettings">
              <Icon name="settings" :size="11" />
              设置
            </button>
          </div>
        </form>
      </div>
    </div>
    <SettingsDialog v-if="showSettings" @close="closeSettings" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
import Switch from '../components/Switch.vue'
import Icon from '../components/Icon.vue'
import { useAuthStore } from '../stores/auth'
import { WindowCenter, GetAppInfo, SetCurrentUser, GetSettings, UpdateCloudSettings, WindowSetSize, WindowSetMinSize, WindowSetMaxSize } from '../composables/useElectron'
import { useWindowState } from '../composables/useWindowState'

const router = useRouter()
const auth = useAuthStore()
const win = useWindowState()

const username = ref('')
const token = ref('')
const error = ref<string | null>(null)
const errorField = ref<'username' | 'token' | null>(null)
const version = ref('')
const showSettings = ref(false)
const cloudEnabled = ref(false)
const cloudUrl = ref('')
const loading = ref(false)

const canSubmit = computed(() => {
  if (!username.value.trim() || !token.value) return false
  if (cloudEnabled.value && !cloudUrl.value.trim()) return false
  return true
})

const onCloudToggle = () => {
  resizeWindowForCloud(cloudEnabled.value)
}

const BASE_HEIGHT = 430
const CLOUD_EXTRA_HEIGHT = 80
function resizeWindowForCloud(enabled: boolean) {
  const h = enabled ? BASE_HEIGHT + CLOUD_EXTRA_HEIGHT : BASE_HEIGHT
  try {
    WindowSetMinSize(0, 0)
    WindowSetMaxSize(0, 0)
    WindowSetSize(320, h)
    WindowSetMinSize(320, h)
  } catch {}
}

watch(cloudEnabled, (enabled) => resizeWindowForCloud(enabled))

onMounted(async () => {
  // 从最大化状态登出后，确保恢复到登录页尺寸
  try { await win.applyLoginLayout() } catch {}
  try {
    const info = await GetAppInfo()
    version.value = info.version
  } catch {}

  try {
    const cfg = await GetSettings()
    cloudEnabled.value = !!cfg.cloud_service_enabled
    cloudUrl.value = cfg.cloud_service_url || ''
  } catch {}
})

async function onSubmit() {
  error.value = null
  errorField.value = null

  if (!username.value.trim()) {
    error.value = '请输入用户名'
    errorField.value = 'username'
    return
  }
  if (!token.value) {
    error.value = '请输入 Token'
    errorField.value = 'token'
    return
  }
  if (cloudEnabled.value && !cloudUrl.value.trim()) {
    error.value = '请填写云服务地址'
    errorField.value = 'token'
    return
  }

  // 先保存云服务配置（URL 变更会清旧 JWT），再走 token 登录
  try {
    await UpdateCloudSettings(cloudEnabled.value, cloudUrl.value.trim())
  } catch (e: any) {
    error.value = '保存云服务配置失败：' + (e?.message ?? e)
    errorField.value = 'token'
    return
  }

  loading.value = true
  const err = await auth.login(username.value.trim(), token.value)
  loading.value = false
  if (err) {
    error.value = err
    errorField.value = 'token'
    return
  }
  // 保存当前登录 UM 账户，作为机器人默认 ChatId
  try {
    if (username.value.trim()) await SetCurrentUser(username.value.trim())
  } catch {}
  // 进入主页前先把窗口切到主布局
  try { await win.applyHomeLayout() } catch {}
  try { WindowCenter() } catch {}
  router.push('/home')
}

async function goSettings() {
  showSettings.value = true
  try { await win.applySettingsLayout() } catch {}
}
async function closeSettings() {
  showSettings.value = false
  try { await win.applyLoginLayout() } catch {}
}
</script>

<style scoped>
.login { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.login-body {
  flex: 1;
  background: var(--bg-primary);
  padding: 18px 10px 14px;
  display: flex; flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  overflow-y: auto;
}
.login-head { display: flex; flex-direction: column; align-items: center; margin-bottom: 10px; margin-top: auto; }
.brand-row { display: flex; align-items: center; gap: 6px; font-size: var(--fs-hero); font-weight: 700; letter-spacing: -0.02em; }
.brand-lynel { color: var(--accent); }
.brand-desktop { color: var(--status-error); font-weight: 500; }
.login-tagline { margin-top: 8px; font-size: var(--fs-body); color: var(--text-secondary); text-align: center; line-height: 1.5; max-width: 280px; }
.login-card {
  width: min(300px, 100%);
  box-sizing: border-box;
  padding: 18px 22px;
  margin-bottom: auto;
  background: var(--material-bg);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
}
.form { width: 100%; display: flex; flex-direction: column; }
.form-group { margin-bottom: 6px; }
.form-label {
  display: block; font-size: 11px; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.6px;
  margin-bottom: 4px; font-weight: 600;
}
.form-input {
  width: 100%;
  background: var(--bg-input); border: 1px solid var(--border-strong);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: 12px;
}
.form-input.error { border-color: var(--status-error); }
.form-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft-bg); }
.form-hint { font-size: 10px; color: var(--status-error); margin-top: 3px; min-height: 14px; }
.cloud-section {
  margin: 8px 0 6px;
  padding: 8px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.cloud-toggle-row {
  display: flex; align-items: center; gap: 8px;
}
.cloud-toggle-label {
  font-size: 12px; color: var(--text-primary); font-weight: 500;
}
.cloud-beta-text {
  font-size: 10px; font-weight: 400;
  color: var(--text-secondary);
}
.cloud-info-icon {
  display: inline-flex; align-items: center;
  margin-left: auto;
  color: var(--accent);
  cursor: help;
  flex-shrink: 0;
  position: relative;
}
.cloud-info-icon:hover::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 8px);
  right: -6px;
  width: 220px;
  padding: 8px 12px;
  background: var(--tooltip-bg);
  color: var(--tooltip-color);
  font-size: 11px;
  line-height: 1.5;
  border-radius: var(--radius-md, 6px);
  box-shadow: var(--shadow-window);
  white-space: normal;
  z-index: 1000;
  pointer-events: none;
}
.cloud-url-group { margin-top: 6px; }
.login-btn {
  width: 100%;
  background: var(--accent);
  color: var(--text-inverse); padding: 8px; border-radius: var(--radius-md);
  font-size: var(--fs-body); font-weight: 500;
  box-shadow: var(--shadow-accent);
  margin-top: 6px;
  transition: filter 0.15s, box-shadow 0.15s, transform 0.1s;
}
.login-btn:hover:not(:disabled) { filter: brightness(1.06); }
.login-btn:active:not(:disabled) { transform: scale(0.98); }
.login-btn:disabled { opacity: 0.4; box-shadow: none; }
.login-footer {
  font-size: 11px; color: var(--text-tertiary); text-align: center; margin-top: 10px;
  display: flex; align-items: center; justify-content: center; gap: 12px;
}
.footer-settings-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 6px; border-radius: 4px;
  color: var(--text-tertiary); font-size: 11px;
  background: transparent; border: 1px solid var(--border);
  cursor: pointer;
}
.footer-settings-btn:hover { color: var(--text-primary); border-color: var(--accent); }
</style>
