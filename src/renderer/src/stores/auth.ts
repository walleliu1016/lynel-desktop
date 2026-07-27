import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Verify, LockoutState, SetPassword } from '../composables/useElectron'

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref(false)
  const attempts = ref(0)
  const lockedUntil = ref<Date | null>(null)

  async function login(password: string): Promise<string | null> {
    try {
      const ok = await Verify(password)
      if (ok) {
        attempts.value = 0
        lockedUntil.value = null
        loggedIn.value = true
        return null
      }
      // Verify 返回 false：可能是未初始化或密码错。统一走 SetPassword
    } catch {
      // Verify 抛错：也走 SetPassword 兜底
    }

    try {
      await SetPassword(password)
      attempts.value = 0
      lockedUntil.value = null
      loggedIn.value = true
      return null
    } catch (e: any) {
      const [a, until] = await LockoutState()
      attempts.value = a
      lockedUntil.value = until && new Date(until).getTime() > Date.now() ? new Date(until) : null
      return e?.message ?? '登录失败'
    }
  }

  return { loggedIn, attempts, lockedUntil, login }
})
