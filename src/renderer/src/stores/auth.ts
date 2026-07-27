import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Verify, LockoutState, SetPassword, IsInitialized } from '../composables/useElectron'

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref(false)
  const attempts = ref(0)
  const lockedUntil = ref<Date | null>(null)

  async function login(password: string): Promise<string | null> {
    // 区分"首次设置密码"和"验证已有密码"：
    // - 未初始化（hash 不存在）-> SetPassword 首次设置
    // - 已初始化 -> 必须通过 Verify，密码错就报错，不允许 SetPassword 覆盖
    //   否则用户输入错误密码会被 SetPassword 当成新密码，绕过校验
    let initialized: boolean
    try {
      initialized = await IsInitialized()
    } catch {
      initialized = false
    }

    if (initialized) {
      // 已初始化：只走 Verify，失败直接报错
      try {
        const ok = await Verify(password)
        if (ok) {
          attempts.value = 0
          lockedUntil.value = null
          loggedIn.value = true
          return null
        }
      } catch {
        // Verify 抛错走下面的 lockout 读取
      }
      const [a, until] = await LockoutState()
      attempts.value = a
      lockedUntil.value = until && new Date(until).getTime() > Date.now() ? new Date(until) : null
      return '密码错误'
    }

    // 未初始化：首次设置密码
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
      return e?.message ?? '设置密码失败'
    }
  }

  return { loggedIn, attempts, lockedUntil, login }
})
