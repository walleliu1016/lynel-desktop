import { defineStore } from 'pinia'
import { ref } from 'vue'
import { LoginWithToken } from '../composables/useElectron'

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref(false)

  // 登录：直接拿 user_id + token 调 cloud /api/auth/login
  // 成功 -> loggedIn = true
  // 失败 -> 返回 error message
  async function login(userId: string, token: string): Promise<string | null> {
    try {
      const r = await LoginWithToken(userId, token)
      if (r?.ok) {
        loggedIn.value = true
        return null
      }
      return r?.error ?? '登录失败'
    } catch (e: any) {
      return e?.message ?? '登录失败'
    }
  }

  function logout() {
    loggedIn.value = false
  }

  return { loggedIn, login, logout }
})
