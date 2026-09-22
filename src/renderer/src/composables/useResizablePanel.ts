import { onBeforeUnmount, ref, type Ref } from 'vue'

export interface ResizablePanelOptions {
  /** 宽度持久化的 localStorage 键 */
  storageKey: string
  /** 读取失败 / 越界时的回退宽度 */
  defaultWidth: number
  min: number
  /** 静态上限（与 dynamicMax 二选一） */
  max?: number
  /** 动态上限，优先于 max。返回 Infinity 表示不设上限（元素尚未挂载时用它） */
  dynamicMax?: () => number
  /** 手柄所在边：'right' = 面板在左、向右拖变宽；'left' = 面板在右、向右拖变窄 */
  handle: 'right' | 'left'
}

export interface ResizablePanel {
  width: Ref<number>
  dragging: Ref<boolean>
  onResizeStart: (e: MouseEvent) => void
  /** 容器尺寸变化后按当前上限重新钳制（如窗口缩放、侧栏折叠） */
  clamp: () => void
}

/**
 * 可拖宽面板的三段式鼠标逻辑 + 宽度持久化。
 * CodeView（文件树宽）、GitPanel（变更列表宽）、EditorSplitPane（分屏右栏宽）共用。
 * 必须在组件 setup 里调用：内部用 onBeforeUnmount 兜底清理监听。
 */
export function useResizablePanel(opts: ResizablePanelOptions): ResizablePanel {
  const upper = () => (opts.dynamicMax ? opts.dynamicMax() : (opts.max ?? Number.POSITIVE_INFINITY))
  const clampTo = (v: number) => Math.min(upper(), Math.max(opts.min, v))

  function loadWidth(): number {
    try {
      const v = Number(localStorage.getItem(opts.storageKey))
      // 越界值（如上次拖到 900 后换了更窄的窗口）不丢弃，交给 clamp 收敛，
      // 直接回退 defaultWidth 会让用户的宽度偏好整个丢失
      if (Number.isFinite(v) && v >= opts.min) return clampTo(v)
    } catch {}
    return opts.defaultWidth
  }

  const width = ref(loadWidth())
  const dragging = ref(false)
  let startX = 0
  let startWidth = 0

  function onResizeStart(e: MouseEvent) {
    e.preventDefault()
    startX = e.clientX
    startWidth = width.value
    dragging.value = true
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', onResizeEnd)
  }

  function onResizeMove(e: MouseEvent) {
    if (!dragging.value) return
    const dx = e.clientX - startX
    width.value = clampTo(startWidth + (opts.handle === 'right' ? dx : -dx))
  }

  function onResizeEnd() {
    if (!dragging.value) return
    dragging.value = false
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
    try {
      localStorage.setItem(opts.storageKey, String(width.value))
    } catch {}
  }

  // 拖拽中组件被卸载（切子页 / 关会话）：清理 document 上的监听，否则会泄漏到全局
  onBeforeUnmount(() => {
    if (dragging.value) onResizeEnd()
  })

  return { width, dragging, onResizeStart, clamp: () => { width.value = clampTo(width.value) } }
}
