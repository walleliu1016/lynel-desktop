import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  DshEnsure,
  DshRestart,
  DshUpdate,
  DshVersion,
  type DshVersionInfo,
} from '../composables/useElectron'
import { pushToast } from '../composables/useToast'

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * DeepSeek Harness（dsh）前端状态。
 *
 * dsh 是主进程的常驻单例，插件（`~/.dsh` profile）改动后不热加载、必须重启才生效，
 * 所以「重启 / 更新」是这一层的操作。iframe 所在页面与侧栏 HarnessMenu 共享同一份
 * URL 与操作进度，因此抽成 store 而不是留在 HomeView 里。
 */
export const useHarnessStore = defineStore('harness', () => {
  /** iframe 加载的 harness 地址；空串表示尚未启动（或启动失败） */
  const url = ref('')
  const loading = ref(false)
  const error = ref('')

  /** 本地已装版本与 registry 最新版本；未查询过为 null */
  const version = ref<DshVersionInfo | null>(null)
  const checking = ref(false)
  const restarting = ref(false)
  const updating = ref(false)
  /** 最近一次更新失败的原因；留在面板里，避免只靠几秒就消失的 toast */
  const updateError = ref('')

  /** 重启 / 更新进行中（耗时操作，按钮据此禁用） */
  const busy = computed(() => restarting.value || updating.value)

  /** 耗时操作的状态文案；空串表示当前不需要展示进度 */
  const busyText = computed(() => {
    if (updating.value) return '正在更新 dsh，完成后会自动重启…'
    if (restarting.value) return '正在重启 DeepSeek Harness…'
    if (loading.value) return '正在启动 DeepSeek Harness…'
    return ''
  })

  /** 有耗时操作在进行：页面显示转圈状态块，侧栏图标也转圈 */
  const pending = computed(() => busyText.value !== '')

  /** registry 上有比本地更新的版本 */
  const hasUpdate = computed(() => {
    const v = version.value
    return !!v?.latest && v.latest !== v.current
  })

  /**
   * dsh 不可执行（没装，或装了但跑不起来 —— 例如上一次安装被打断导致依赖残缺）。
   * 此时面板提供「重新安装」而不是「更新」，否则用户没有出路。
   */
  const needsInstall = computed(() => !!version.value && !version.value.current)

  /** 启动 harness；已就绪或正在启动时直接返回（切 tab 时反复调用不会重复 spawn）。 */
  async function ensure(): Promise<void> {
    if (url.value || loading.value) return
    loading.value = true
    error.value = ''
    try {
      url.value = (await DshEnsure()).url
    } catch (e) {
      error.value = errText(e)
    } finally {
      loading.value = false
    }
  }

  /** 真正重启；失败时旧地址已随进程失效，抛错由调用方决定提示方式 */
  async function doRestart(): Promise<void> {
    restarting.value = true
    // 旧进程马上被杀，先撤掉地址：页面转成「重启中」状态，而不是停在 iframe 的连接错误页
    url.value = ''
    try {
      url.value = (await DshRestart()).url
    } finally {
      restarting.value = false
    }
  }

  /** 重启 harness（装完插件后让 profile 生效）。 */
  async function restart(): Promise<boolean> {
    if (busy.value) return false
    try {
      await doRestart()
      error.value = ''
      pushToast({ level: 'info', source: 'harness', message: 'Harness 已重启' })
      return true
    } catch (e) {
      // 旧进程已被杀，地址失效 —— 清掉 url 让页面显示错误态（而不是停在死地址）
      url.value = ''
      error.value = errText(e)
      pushToast({ level: 'error', source: 'harness', message: `重启 Harness 失败：${errText(e)}` })
      return false
    }
  }

  /** 查询本地版本与 registry 最新版本（面板打开时调用）。 */
  async function checkVersion(): Promise<void> {
    if (checking.value) return
    checking.value = true
    try {
      version.value = await DshVersion()
    } catch (e) {
      version.value = null
      pushToast({ level: 'error', source: 'harness', message: errText(e) })
    } finally {
      checking.value = false
    }
  }

  /**
   * 更新 dsh 本体到最新版。
   *
   * 主进程会先停掉 harness（Windows 下运行中的 node 锁定全局包文件），期间页面显示
   * 「正在更新」转圈；装好后若原本在用 harness，自动重启并切到新地址。整个过程是后台
   * 进行的 —— 面板可以关掉，侧栏图标会一直转圈。
   */
  async function update(): Promise<boolean> {
    if (busy.value) return false
    updating.value = true
    const wasRunning = !!url.value
    // 主进程随即会杀掉 harness，先撤掉失效地址让页面转入进度态
    url.value = ''
    error.value = ''
    updateError.value = ''
    try {
      const { version: v } = await DshUpdate()
      version.value = { current: v, latest: v }
      if (wasRunning) {
        try {
          await doRestart()
        } catch (e) {
          // 更新本身成功，只是没拉起来：留在错误态，用户可手动重试启动
          error.value = errText(e)
          pushToast({ level: 'warn', source: 'harness', message: `dsh 已更新到 ${v}，但重启失败：${errText(e)}` })
          return true
        }
      }
      pushToast({ level: 'info', source: 'harness', message: `dsh 已更新到 ${v}` })
      return true
    } catch (e) {
      updateError.value = errText(e)
      pushToast({
        level: 'error',
        source: 'harness',
        message: `更新 dsh 失败：${errText(e)}`,
        duration: 10000,
      })
      // 安装失败时 harness 还停在已停掉的状态，把原来在跑的那个版本拉回来
      if (wasRunning) void ensure()
      return false
    } finally {
      updating.value = false
    }
  }

  return {
    url, loading, error,
    version, checking, restarting, updating, updateError, busy, pending, busyText, hasUpdate, needsInstall,
    ensure, restart, checkVersion, update,
  }
})
