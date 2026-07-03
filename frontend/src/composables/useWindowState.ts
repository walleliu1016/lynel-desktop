import { readonly, ref } from 'vue'
import {
  WindowHide,
  WindowIsMaximised,
  WindowMaximise,
  WindowMinimise,
  WindowSetMaxSize,
  WindowSetMinSize,
  WindowSetSize,
  WindowShow,
  WindowToggleMaximise,
  WindowUnmaximise,
} from './useWails'

const HOME = { width: 1280, height: 800, minWidth: 1024, minHeight: 680 }
const LOGIN = { width: 320, height: 400, minWidth: 320, minHeight: 400 }
const SETTINGS = { width: 700, height: 520, minWidth: 700, minHeight: 520 }

let initialized = false
const isMaximized = ref(false)

async function syncMaximized() {
  try {
    isMaximized.value = await WindowIsMaximised()
  } catch {
    // ignore
  }
}

function init() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  // 初始同步一次
  void syncMaximized()

  // 监听窗口尺寸变化，同步最大化状态，替代 HomeView 的 500ms 轮询
  window.addEventListener('resize', () => {
    void syncMaximized()
  })
}

async function resetAndResize(
  width: number,
  height: number,
  minWidth: number,
  minHeight: number,
  maxWidth: number = 0,
  maxHeight: number = 0,
) {
  const rt = window.runtime
  if (!rt) return

  rt.WindowSetMinSize(0, 0)
  rt.WindowSetMaxSize(0, 0)
  await new Promise<void>((r) => setTimeout(r, 0))
  rt.WindowSetSize(width, height)
  await new Promise<void>((r) => setTimeout(r, 0))
  rt.WindowSetMinSize(minWidth, minHeight)
  if (maxWidth > 0 && maxHeight > 0) {
    rt.WindowSetMaxSize(maxWidth, maxHeight)
  }
}

export function useWindowState() {
  init()

  return {
    isMaximized: readonly(isMaximized),

    show: () => WindowShow(),
    minimize: () => WindowMinimise(),
    hide: () => WindowHide(),

    async toggleMaximize() {
      WindowToggleMaximise()
      // Wails runtime 需要一帧才能反映新状态
      await new Promise<void>((r) => setTimeout(r, 80))
      await syncMaximized()
    },

    async applyLoginLayout() {
      try { WindowUnmaximise() } catch {}
      await resetAndResize(LOGIN.width, LOGIN.height, LOGIN.minWidth, LOGIN.minHeight)
    },

    async applyHomeLayout() {
      try { WindowUnmaximise() } catch {}
      await resetAndResize(HOME.width, HOME.height, HOME.minWidth, HOME.minHeight)
    },

    async applySettingsLayout() {
      try { WindowUnmaximise() } catch {}
      await resetAndResize(SETTINGS.width, SETTINGS.height, SETTINGS.minWidth, SETTINGS.minHeight)
    },

    async maximize() {
      WindowMaximise()
      await new Promise<void>((r) => setTimeout(r, 80))
      await syncMaximized()
    },

    async unmaximize() {
      WindowUnmaximise()
      await new Promise<void>((r) => setTimeout(r, 80))
      await syncMaximized()
    },
  }
}
