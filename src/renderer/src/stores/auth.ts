import { defineStore } from 'pinia'
import { ref } from 'vue'
import { LoginWithToken, AuthRestoreState } from '../composables/useElectron'

export type AutoLoginState = 'none' | 'pending' | 'done'

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref(false)
  const autoLoginState = ref<AutoLoginState>('none')

  // 登录：直接拿 user_id + token 调 cloud /api/auth/login
  // 成功 -> loggedIn = true；remember 决定是否持久化 JWT（主进程处理）
  async function login(userId: string, token: string, remember: boolean): Promise<string | null> {
    try {
      const r = await LoginWithToken(userId, token, remember)
      if (r?.ok) {
        loggedIn.value = true
        autoLoginState.value = 'done'
        return null
      }
      return r?.error ?? '登录失败'
    } catch (e: any) {
      return e?.message ?? '登录失败'
    }
  }

  // 启动免登录分流：决策由主进程 decideRestore 纯函数算好（'home'|'pending'|'form'），这里只消费
  async function tryAutoLogin(): Promise<'home' | 'pending' | 'form'> {
    try {
      const s = await AuthRestoreState()
      if (s?.decision === 'home') {
        loggedIn.value = true
        autoLoginState.value = 'done'
        return 'home'
      }
      if (s?.decision === 'pending') {
        autoLoginState.value = 'pending'
        return 'pending'
      }
      return 'form'
    } catch {
      return 'form'
    }
  }

  function markAuthenticated() {
    loggedIn.value = true
    autoLoginState.value = 'done'
  }

  function logout() {
    loggedIn.value = false
    autoLoginState.value = 'none'
  }

  return { loggedIn, autoLoginState, login, tryAutoLogin, markAuthenticated, logout }
})
