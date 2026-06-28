<template>
  <div class="login">
    <TitleBar @minimize="onMinimize" @maximize="onMaximize" @close="onClose" />
    <div class="login-body">
      <div class="login-head">
        <div class="login-logo">E</div>
        <div class="login-title">登录 Ease</div>
      </div>

      <form @submit.prevent="onSubmit" class="form">
        <div class="form-group">
          <label class="form-label">用户名</label>
          <input
            class="form-input"
            v-model="username"
            :disabled="locked"
            autocomplete="username"
          />
        </div>

        <div class="form-group">
          <label class="form-label">密码</label>
          <input
            class="form-input"
            v-model="password"
            :class="{ error: !!error }"
            type="password"
            placeholder="输入密码"
            :disabled="locked"
            autocomplete="current-password"
          />
          <div class="form-hint">
            <template v-if="locked">已锁定 · {{ lockCountdown }} 后重试</template>
            <template v-else-if="error">{{ error }}</template>
          </div>
        </div>

        <button class="login-btn" type="submit" :disabled="locked || !password">
          登录
        </button>
        <div class="login-footer">Ease v{{ version }}</div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from '../components/TitleBar.vue'
import { useAuthStore } from '../stores/auth'
import { WindowMinimise, WindowToggleMaximise, WindowQuit } from '../composables/useWails'

const router = useRouter()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
const version = ref('0.1.0')

const locked = computed(() => !!auth.lockedUntil)
const lockCountdown = computed(() => {
  if (!auth.lockedUntil) return ''
  const ms = auth.lockedUntil.getTime() - Date.now()
  if (ms <= 0) return '00:00'
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
})

let timer: number | null = null
onMounted(async () => {
  // Detect OS user via window.__OS_USER__? For now, fetch from Wails at startup.
  // We use a simple "akke" placeholder; real impl reads env via a binding.
  try {
    const u = await (window as any).go?.app?.App?.OSUsername?.()
    if (u) username.value = u
  } catch {}
  timer = window.setInterval(() => {
    // trigger computed re-eval
    if (auth.lockedUntil && auth.lockedUntil.getTime() <= Date.now()) {
      auth.lockedUntil = null
    }
  }, 1000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

async function onSubmit() {
  error.value = null
  const err = await auth.login(password.value)
  if (err) error.value = err
  else router.push('/home')
}

function onMinimize() { WindowMinimise() }
function onMaximize() { WindowToggleMaximise() }
function onClose()    { WindowQuit() }
</script>

<style scoped>
.login { display: flex; flex-direction: column; height: 100vh; }
.login-body {
  flex: 1;
  background: radial-gradient(ellipse at top, #1a1230 0%, var(--bg-primary) 70%);
  padding: 28px 32px 22px;
  display: flex; flex-direction: column;
}
.login-head { display: flex; flex-direction: column; align-items: center; margin-bottom: 18px; }
.login-logo {
  width: 36px; height: 36px; border-radius: 9px;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  display: flex; align-items: center; justify-content: center;
  color: white; font-size: 16px; font-weight: 700;
  box-shadow: var(--shadow-accent);
  margin-bottom: 10px;
}
.login-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.form { flex: 1; display: flex; flex-direction: column; }
.form-group { margin-bottom: 10px; }
.form-label {
  display: block; font-size: 9px; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.8px;
  margin-bottom: 4px; font-weight: 600;
}
.form-input {
  width: 100%;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 8px 11px;
  color: var(--text-primary); font-size: 12px;
}
.form-input.error { border-color: var(--status-error); }
.form-input:focus { outline: none; border-color: var(--accent); }
.form-input:disabled { opacity: 0.5; cursor: not-allowed; }
.form-hint { font-size: 10px; color: var(--status-error); margin-top: 4px; min-height: 14px; }
.login-btn {
  width: 100%;
  background: linear-gradient(135deg, var(--accent), #6D28D9);
  color: white; padding: 8px; border-radius: var(--radius-md);
  font-size: 12px; font-weight: 500;
  box-shadow: var(--shadow-accent);
  margin-top: 4px;
}
.login-btn:disabled { opacity: 0.4; box-shadow: none; }
.login-footer { font-size: 9px; color: var(--text-tertiary); text-align: center; margin-top: 12px; }
</style>
