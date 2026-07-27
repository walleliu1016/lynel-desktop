<template>
  <div class="login">
    <TitleBar center hide-settings />
    <div class="login-body">
      <div class="login-head">
        <div class="login-logo">L</div>
        <div class="login-title-row">
          <span class="login-title">登录 Lynel Desktop</span>
        </div>
      </div>

      <form @submit.prevent="onSubmit" class="form">
        <div class="form-group">
          <label class="form-label">用户名</label>
          <input
            class="form-input"
            :class="{ error: errorField === 'username' }"
            v-model="username"
            placeholder="UM账户"
            :disabled="locked"
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
            :class="{ error: errorField === 'password' }"
            v-model="password"
            type="password"
            :placeholder="cloudEnabled ? 'PIN+Token' : '密码任意'"
            :disabled="locked"
            autocomplete="current-password"
          />
          <div class="form-hint">
            <template v-if="locked">已锁定 · {{ lockCountdown }} 后重试</template>
            <template v-else-if="errorField === 'password'">{{ error }}</template>
          </div>
        </div>

        <div class="cloud-section">
          <div class="cloud-toggle-row">
            <Switch v-model="cloudEnabled" @change="onCloudToggle" />
            <span class="cloud-toggle-label">启用云服务</span>
          </div>
          <div class="cloud-hint" v-if="cloudEnabled">
            开启后，会话消息与权限请求将实时推送到移动 App，便于远程审批与查看进度
          </div>
          <div class="cloud-url-group" v-if="cloudEnabled">
            <label class="form-label">服务地址</label>
            <input
              class="form-input"
              v-model="cloudUrl"
              placeholder="https://ease.example.com"
              :disabled="locked"
            />
          </div>
        </div>

        <button class="login-btn" type="submit" :disabled="locked || !canSubmit">
          登录
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
    <SettingsDialog v-if="showSettings" @close="closeSettings" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
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
const password = ref('')
const error = ref<string | null>(null)
const errorField = ref<'username' | 'password' | null>(null)
const version = ref('')
const showSettings = ref(false)
const cloudEnabled = ref(false)
const cloudUrl = ref('')

const locked = computed(() => !!auth.lockedUntil)
const lockCountdown = computed(() => {
  if (!auth.lockedUntil) return ''
  const ms = auth.lockedUntil.getTime() - Date.now()
  if (ms <= 0) return '00:00'
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
})

const canSubmit = computed(() => {
  if (!username.value.trim() || !password.value) return false
  // 启用云服务时必须填 URL
  if (cloudEnabled.value && !cloudUrl.value.trim()) return false
  return true
})

const onCloudToggle = () => {
  // 开关切换时不需要立刻保存配置，登录时会统一保存
  // 但需要立即调整窗口高度，避免内容超出把登录按钮挤出可视区域
  resizeWindowForCloud(cloudEnabled.value)
}

// 开启云服务时窗口高度 +120 容纳开关 + 提示 + URL 输入框
const BASE_HEIGHT = 400
const CLOUD_EXTRA_HEIGHT = 120
function resizeWindowForCloud(enabled: boolean) {
  const h = enabled ? BASE_HEIGHT + CLOUD_EXTRA_HEIGHT : BASE_HEIGHT
  try {
    // 先解除 min/max 限制，否则 setSize 会被 clamp
    WindowSetMinSize(0, 0)
    WindowSetMaxSize(0, 0)
    WindowSetSize(320, h)
    WindowSetMinSize(320, h)
  } catch {}
}

// 监听 cloudEnabled 变化，确保任何路径（包括 onMounted 预填）都能调整窗口
watch(cloudEnabled, (enabled) => resizeWindowForCloud(enabled))

let timer: number | null = null
onMounted(async () => {
  try {
    const info = await GetAppInfo()
    version.value = info.version
  } catch {}

  // 读取已保存的云服务配置，预填到界面
  try {
    const cfg = await GetSettings()
    cloudEnabled.value = !!cfg.cloud_service_enabled
    cloudUrl.value = cfg.cloud_service_url || ''
  } catch {}

  timer = window.setInterval(() => {
    if (auth.lockedUntil && auth.lockedUntil.getTime() <= Date.now()) {
      auth.lockedUntil = null
    }
  }, 1000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

async function onSubmit() {
  error.value = null
  errorField.value = null

  if (!username.value.trim()) {
    error.value = '请输入用户名'
    errorField.value = 'username'
    return
  }
  if (!password.value) {
    error.value = '请输入密码'
    errorField.value = 'password'
    return
  }
  if (cloudEnabled.value && !cloudUrl.value.trim()) {
    error.value = '请填写云服务地址'
    errorField.value = 'password'
    return
  }

  // 先保存云服务配置（URL 变更会清旧 JWT），再走密码校验/设置流程
  // app:verify / app:setPassword 内部会触发 applyCloudSettings 连接 cloud
  try {
    await UpdateCloudSettings(cloudEnabled.value, cloudUrl.value.trim())
  } catch (e: any) {
    error.value = '保存云服务配置失败：' + (e?.message ?? e)
    errorField.value = 'password'
    return
  }

  const err = await auth.login(password.value)
  if (err) {
    error.value = err
    errorField.value = 'password'
    return
  }
  // 保存当前登录 UM 账户，作为机器人默认 ChatId
  try {
    if (username.value.trim()) await SetCurrentUser(username.value.trim())
  } catch {}
  // 进入主页前先把窗口切到主布局，避免 HomeView 挂载后闪现小窗口再变大
  try { await win.applyHomeLayout() } catch {}
  try { WindowCenter() } catch {}
  router.push('/home')
}

async function goSettings() {
  showSettings.value = true
  // 弹窗需要更大空间，临时放大窗口
  try { await win.applySettingsLayout() } catch {}
}
async function closeSettings() {
  showSettings.value = false
  // 关闭弹窗后恢复登录小窗口
  try { await win.applyLoginLayout() } catch {}
}
</script>

<style scoped>
.login { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.login-body {
  flex: 1;
  background: radial-gradient(ellipse at top, var(--bg-input) 0%, var(--bg-primary) 70%);
  padding: 18px 22px 14px;
  display: flex; flex-direction: column;
  justify-content: center;
}
.login-head { display: flex; flex-direction: column; align-items: center; margin-bottom: 10px; }
.login-logo {
  width: 28px; height: 28px; border-radius: 7px;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  display: flex; align-items: center; justify-content: center;
  color: white; font-size: 13px; font-weight: 700;
  box-shadow: var(--shadow-accent);
  margin-bottom: 6px;
}
.login-title-row { display: flex; align-items: center; gap: 8px; }
.login-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.settings-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: var(--radius-md);
  color: var(--text-secondary); font-size: 10px; font-weight: 500;
  background: var(--bg-input); border: 1px solid var(--border);
  cursor: pointer;
}
.settings-btn:hover { color: var(--text-primary); background: var(--bg-panel); border-color: var(--accent); }
.settings-btn > svg { display: inline-block; }
.form { flex: 1; display: flex; flex-direction: column; }
.form-group { margin-bottom: 6px; }
.form-label {
  display: block; font-size: 11px; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.6px;
  margin-bottom: 4px; font-weight: 600;
}
.form-input {
  width: 100%;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: 12px;
}
.form-input.error { border-color: var(--status-error); }
.form-input:focus { outline: none; border-color: var(--accent); }
.form-input:disabled { opacity: 0.5; cursor: not-allowed; }
.form-hint { font-size: 10px; color: var(--status-error); margin-top: 3px; min-height: 14px; }
.cloud-section {
  margin: 8px 0 6px;
  padding: 8px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.cloud-toggle-row {
  display: flex; align-items: center; gap: 8px;
}
.cloud-toggle-label {
  font-size: 12px; color: var(--text-primary); font-weight: 500;
}
.cloud-hint {
  font-size: 10px; color: var(--text-tertiary);
  line-height: 1.5;
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--bg-panel);
  border-radius: var(--radius-sm);
  border-left: 2px solid var(--accent);
}
.cloud-url-group { margin-top: 6px; }
.login-btn {
  width: 100%;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: white; padding: 8px; border-radius: var(--radius-md);
  font-size: 13px; font-weight: 500;
  box-shadow: var(--shadow-accent);
  margin-top: 6px;
  transition: filter 0.15s, box-shadow 0.15s;
}
.login-btn:hover:not(:disabled) { filter: brightness(1.05); }
.login-btn:active:not(:disabled) { filter: brightness(0.95); }
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
