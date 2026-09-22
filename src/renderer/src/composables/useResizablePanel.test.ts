// 验证可拖宽面板 composable：上下限钳制、反向手柄、动态上限、持久化
import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, nextTick, shallowRef } from 'vue'
import { useResizablePanel, type ResizablePanelOptions } from './useResizablePanel'

const KEY = 'lynel:test-panel-width'

/** composable 里用了 onBeforeUnmount，必须在组件上下文里调用 */
function mountPanel(opts: Partial<ResizablePanelOptions> = {}) {
  // 只能 shallowRef：深 ref 会把返回句柄里的 ref 拆掉（`api.value.width` 直接变成 number，
  // 运行时报 undefined、类型上 TS2551），`api.value!.width.value` 就取不到值
  const api = shallowRef<ReturnType<typeof useResizablePanel> | null>(null)
  const wrapper = mount(defineComponent({
    setup() {
      api.value = useResizablePanel({
        storageKey: KEY,
        defaultWidth: 300,
        min: 240,
        max: 600,
        handle: 'right',
        ...opts,
      })
      return () => null
    },
  }))
  return { wrapper, api }
}

describe('useResizablePanel', () => {
  beforeEach(() => { localStorage.clear(); document.body.style.userSelect = '' })
  afterEach(() => { document.body.style.userSelect = '' })

  it('无持久化值时用 defaultWidth', () => {
    const { api } = mountPanel()
    expect(api.value!.width.value).toBe(300)
  })

  it('读取 localStorage 里合法的宽度', () => {
    localStorage.setItem(KEY, '450')
    const { api } = mountPanel()
    expect(api.value!.width.value).toBe(450)
  })

  it('localStorage 值超上限时收敛到上限（不整个丢弃用户的宽度偏好）', () => {
    localStorage.setItem(KEY, '9999')
    const { api } = mountPanel()
    expect(api.value!.width.value).toBe(600)
  })

  it('localStorage 值非法时回退 defaultWidth', () => {
    localStorage.setItem(KEY, 'abc')
    const { api } = mountPanel()
    expect(api.value!.width.value).toBe(300)
  })

  it('localStorage 值低于下限时回退 defaultWidth（下限不靠 clamp 收敛）', () => {
    localStorage.setItem(KEY, '100')
    const { api } = mountPanel()
    expect(api.value!.width.value).toBe(300)
  })

  it("handle:'right' 向右拖变宽", () => {
    const { api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }))
    expect(api.value!.width.value).toBe(450)
  })

  it('宽度钳制到上限', () => {
    const { api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100000 }))
    expect(api.value!.width.value).toBe(600)
  })

  it('宽度钳制到下限', () => {
    const { api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -100000 }))
    expect(api.value!.width.value).toBe(240)
  })

  it("handle:'left' 向右拖变窄（手柄在面板左侧）", () => {
    // defaultWidth 提到 500：300 起步时任何「变窄」都会被 min(240) 截断，
    // 断言就变成在测钳制而不是在测方向
    const { api } = mountPanel({ handle: 'left', defaultWidth: 500 })
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 500 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600 }))
    expect(api.value!.width.value).toBe(400)
  })

  it("handle:'left' 向左拖变宽（与 'right' 方向相反）", () => {
    const { api } = mountPanel({ handle: 'left', defaultWidth: 500 })
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 500 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }))
    expect(api.value!.width.value).toBe(600)
  })

  it('dynamicMax 优先于 max', () => {
    const { api } = mountPanel({ dynamicMax: () => 500 })
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100000 }))
    expect(api.value!.width.value).toBe(500)
  })

  it('dynamicMax 返回 Infinity 时不设上限', () => {
    const { api } = mountPanel({ dynamicMax: () => Number.POSITIVE_INFINITY })
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000 }))
    expect(api.value!.width.value).toBe(5200)
  })

  it('clamp() 按当前上限重新钳制', async () => {
    let limit = 600
    const { api } = mountPanel({ dynamicMax: () => limit })
    api.value!.width.value = 580
    limit = 400
    api.value!.clamp()
    await nextTick()
    expect(api.value!.width.value).toBe(400)
  })

  it('mouseup 写 localStorage 并结束拖拽', () => {
    const { api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(localStorage.getItem(KEY)).toBe('450')
    expect(api.value!.dragging.value).toBe(false)
    expect(document.body.style.userSelect).toBe('')
  })

  it('mouseup 之后 mousemove 不再改宽度', () => {
    const { api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }))
    expect(api.value!.width.value).toBe(300)
  })

  it('卸载时清理监听（拖拽中卸载不报错）', () => {
    const { wrapper, api } = mountPanel()
    api.value!.onResizeStart(new MouseEvent('mousedown', { clientX: 100 }))
    expect(() => wrapper.unmount()).not.toThrow()
    expect(api.value!.dragging.value).toBe(false)
    expect(document.body.style.userSelect).toBe('')
  })
})
