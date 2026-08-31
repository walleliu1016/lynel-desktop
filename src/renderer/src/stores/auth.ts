import { defineStore } from 'pinia'
import { ref } from 'vue'
import { LoginWithToken } from '../composables/useElectron'

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref(false)

  // 登录：直接拿 user_id + token 调 cloud /api/auth/login
  // 成功 -> loggedIn = true
  // 失败 -> 返回 error message
  // 占位实现：remember 固定传 true 以满足 3 参签名；Task 4 会重写本 store（记住我勾选 + 自动登录）
  async function login(userId: string, token: string): Promise<string | null> {
    try {
      const r = await LoginWithToken(userId, token, true)
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
