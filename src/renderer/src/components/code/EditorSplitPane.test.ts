// 验证分屏右栏：头部标签、收起/跳转事件、拖宽钳制（保证左侧终端至少 400px）
import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import EditorSplitPane from './EditorSplitPane.vue'
import { useFilesStore } from '../../stores/files'

// files store 在**创建 store 时**就会 initWatcher() 订阅 FileChanged，而 useElectron
// 的 api() 在 window.electronAPI 缺失时直接抛错。jsdom 下没有 preload，故按 CodeView.test.ts
// 的先例把整层 IPC 转发 mock 掉，否则每个挂载了本组件的用例都会在 setup 阶段炸掉。
vi.mock('../../composables/useElectron', () => ({
  FileListDir: vi.fn(() => Promise.resolve([])),
  FileRead: vi.fn(() => Promise.resolve({ content: '', binary: false, truncated: false })),
  FileWrite: vi.fn(() => Promise.resolve({ ok: true })),
  FileCreate: vi.fn(() => Promise.resolve({ ok: true })),
  FileRename: vi.fn(() => Promise.resolve({ ok: true })),
  FileDelete: vi.fn(() => Promise.resolve({ ok: true })),
  FileWatch: vi.fn(() => Promise.resolve()),
  FileUnwatch: vi.fn(() => Promise.resolve()),
  FileChanged: vi.fn(() => vi.fn()),
  GitChanged: vi.fn(() => vi.fn()),
}))
vi.mock('./FileEditorPanel.vue', () => ({
  default: { name: 'FileEditorPanelStub', template: '<div class="editor-panel" />' },
}))
vi.mock('../Icon.vue', () => ({
  default: { name: 'IconStub', props: ['name', 'size'], template: '<span :data-icon="name" />' },
}))

/** 建过的 observer 实例，供「卸载时断开」用例取用 */
let observers: ResizeObserverStub[] = []

class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  constructor() {
    observers.push(this)
  }
}

const WIDTH_KEY = 'lynel:editor-split-width'

/** 当前挂载的右栏，供 afterEach 统一卸载 */
let current: VueWrapper | null = null

/** 必须真卸载而不是只清 body.innerHTML：`document.body.innerHTML = ''` 不会跑
 *  onBeforeUnmount，ResizeObserver 不会 disconnect、拖拽挂在 document 上的
 *  mousemove / mouseup 也会活到下一个用例（靠「最新的实例监听者胜出」侥幸通过）。 */
function unmountCurrent() {
  const w = current
  current = null
  w?.unmount()
}

/** 用固定容器宽度模拟真实分屏容器（jsdom 的 clientWidth 恒为 0）。
 *  宽度必须在挂载**之前**生效 —— 组件 onMounted 里的 clamp() 要读它。
 *
 *  不能只写在 attachTo 的容器上：VTU 会在该容器与组件根节点之间再插一层自己的
 *  挂载点 div（见 @vue/test-utils 的 `const el = document.createElement('div')`），
 *  组件的 `rootEl.parentElement` 是那一层，量不到写在容器上的宽度。故从
 *  `Element.prototype` 上把这个只读 getter 打掉。
 *
 *  且必须按 `this` 区分元素：只让「包含分屏根节点的容器」报出模拟宽度，其余元素
 *  （尤其 `document.body` 和 `.editor-split` 自己）一律 0。否则把 dynamicMax 改成量
 *  自身（上限 = 自身宽 - 404，自激振荡，是真 bug）或量 body 也能蒙混过关。 */
let restoreClientWidth: (() => void) | null = null

function mountPane(containerWidth: number) {
  restoreClientWidth?.()
  const spy = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this !== document.body && !!this.querySelector('.editor-split') ? containerWidth : 0
  })
  // 只卸这一处 spy：不用 vi.restoreAllMocks()，否则 useElectron 那层 mock 的
  // 实现（FileChanged 返回一个清理函数等）也会被一起清空
  restoreClientWidth = () => spy.mockRestore()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const wrapper = mount(EditorSplitPane, { attachTo: container })
  current = wrapper
  return wrapper
}

describe('EditorSplitPane', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    observers = []
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    document.body.style.userSelect = ''
  })

  afterEach(() => {
    unmountCurrent()
    restoreClientWidth?.()
    restoreClientWidth = null
    document.body.innerHTML = ''
    document.body.style.userSelect = ''
  })

  it('渲染编辑器面板与头部文件名', () => {
    const store = useFilesStore()
    store.openFiles = [{
      relPath: 'src/main/app.ts', content: '', dirty: false, binary: false,
      truncated: false, externalChanged: false, savedVersion: 0,
    }]
    store.activeRelPath = 'src/main/app.ts'
    const wrapper = mountPane(1200)
    expect(wrapper.find('.editor-panel').exists()).toBe(true)
    expect(wrapper.find('.split-head .name').text()).toBe('src/main/app.ts')
  })

  it('没有激活文件时头部显示占位文案', () => {
    const wrapper = mountPane(1200)
    expect(wrapper.find('.split-head .name').text()).toBe('未打开文件')
  })

  it('看 diff 时头部显示路径与对比说明', () => {
    const store = useFilesStore()
    store.diffRequest = { relPath: 'src/main/app.ts', left: 'HEAD', right: 'WORKTREE', label: '工作区' }
    store.activeView = 'diff'
    const wrapper = mountPane(1200)
    expect(wrapper.find('.split-head .name').text()).toBe('src/main/app.ts · 工作区')
  })

  it('点 × emit collapse', async () => {
    const wrapper = mountPane(1200)
    await wrapper.find('.split-head .hbtn.icon').trigger('click')
    expect(wrapper.emitted('collapse')).toHaveLength(1)
  })

  it('点「在文件中打开」emit open-in-files', async () => {
    const wrapper = mountPane(1200)
    const btn = wrapper.findAll('.split-head .hbtn').find((b) => b.text().includes('在文件中打开'))
    await btn!.trigger('click')
    expect(wrapper.emitted('open-in-files')).toHaveLength(1)
  })

  it('默认宽度 480px', () => {
    const wrapper = mountPane(1200)
    expect((wrapper.element as HTMLElement).style.width).toBe('480px')
  })

  it('拖宽上限保证左侧终端至少 400px（容器 1200 → 上限 796）', async () => {
    const wrapper = mountPane(1200)
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 800 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -100000 }))
    // 宽度是响应式的：mousemove 同步改了 ref，DOM 的 style 要等一个 tick 才刷
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('796px')
  })

  it('拖宽下限 320px', async () => {
    const wrapper = mountPane(1200)
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 200 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100000 }))
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('320px')
  })

  it('容器过窄时上限退化为 320px', async () => {
    localStorage.setItem(WIDTH_KEY, '500')
    const wrapper = mountPane(600)
    // onMounted 的 clamp() 改的是 ref，等一个 tick 才会反映到 style
    await nextTick()
    // 挂载后按动态上限收敛：max(320, 600 - 400 - 4) = 320
    expect((wrapper.element as HTMLElement).style.width).toBe('320px')
  })

  it('容器量到 0 宽（祖先 v-show 隐藏）时不钳制，保留恢复的宽度', async () => {
    // 必须与「过窄」区分开：0 宽 = 量不到（不设上限），不是「容器只有 0px」
    localStorage.setItem(WIDTH_KEY, '680')
    const wrapper = mountPane(0)
    // 必须等一个 tick：旧守卫下 onMounted 的 clamp() 会同步把 ref 改成 320，
    // 同步读 style 只会读到挂载时的旧值 680，用例就不再能区分新旧行为了
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('680px')
  })

  it('卸载时断开 ResizeObserver', () => {
    mountPane(1200)
    const ro = observers[observers.length - 1]
    expect(ro.disconnect).not.toHaveBeenCalled()
    unmountCurrent()
    expect(ro.disconnect).toHaveBeenCalled()
  })

  it('拖拽结束写入 localStorage', async () => {
    const wrapper = mountPane(1200)
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 600 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    // 手柄在右栏左侧：左移 200px → 右栏变宽 480 → 680
    expect(localStorage.getItem(WIDTH_KEY)).toBe('680')
  })
})
