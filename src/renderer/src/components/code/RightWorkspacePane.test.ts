// 验证会话右栏：顶部行（文件标识/全屏/收起）、宽度初始化（首展开=容器50%）、
// 拖宽钳制（左区至少 400px）、全屏态、collapse / toggle-fullscreen 事件
import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { nextTick, defineComponent, h, ref, watch } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import RightWorkspacePane from './RightWorkspacePane.vue'
import { useFilesStore } from '../../stores/files'

// files store 创建时即 initWatcher() 订阅 FileChanged，jsdom 无 preload，
// 按 CodeView.test.ts 先例 mock 整层 IPC 转发
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
// CodeView 深层会拉 Monaco 相关组件，整棵 stub 掉
vi.mock('./CodeView.vue', () => ({
  default: { name: 'CodeViewStub', props: ['visible'], template: '<div class="code-view-stub" />' },
}))
vi.mock('./FileTabs.vue', () => ({
  default: { name: 'FileTabsStub', template: '<div class="file-tabs-stub" />' },
}))
vi.mock('../Icon.vue', () => ({
  default: { name: 'IconStub', props: ['name', 'size'], template: '<span :data-icon="name" />' },
}))

const WIDTH_KEY = 'lynel:right-panel-width'

let observers: ResizeObserverStub[] = []
class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  constructor() { observers.push(this) }
}

/** 当前挂载的右栏，afterEach 统一卸载（必须真卸载：否则 ResizeObserver /
 *  document 上的 mousemove 监听会活到下一个用例） */
let current: VueWrapper | null = null
function unmountCurrent() {
  const w = current
  current = null
  w?.unmount()
}

/** jsdom 的 clientWidth 恒为 0：从 Element.prototype 打掉这个只读 getter，
 *  只让「包含 .right-pane 的容器」报出模拟宽度，其余（body、右栏自身）一律 0。
 *  必须在挂载前生效 —— onMounted 的宽度初始化要读它。 */
let restoreClientWidth: (() => void) | null = null
function mountPane(containerWidth: number, props: { visible: boolean; maximized?: boolean } = { visible: true }) {
  restoreClientWidth?.()
  const spy = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this !== document.body && !!this.querySelector('.right-pane') ? containerWidth : 0
  })
  restoreClientWidth = () => spy.mockRestore()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const wrapper = mount(RightWorkspacePane, { props, attachTo: container })
  current = wrapper
  return wrapper
}

describe('RightWorkspacePane', () => {
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

  it('渲染文件标识 tab、全屏/收起按钮与 CodeView', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    expect(wrapper.find('.ws-label').text()).toContain('文件')
    expect(wrapper.find('.head-btn[title="全屏"]').exists()).toBe(true)
    expect(wrapper.find('.head-btn[aria-label="收起右栏"]').exists()).toBe(true)
    expect(wrapper.find('.code-view-stub').exists()).toBe(true)
  })

  it('visible=false 收起：完全隐藏顶部行、主体 v-show 隐藏、只留右缘展开按钮', async () => {
    const wrapper = mountPane(1200, { visible: false })
    await nextTick()
    // 根元素不整体隐藏（CodeView v-show 常驻挂载），不写内联 width（宽度自适应展开按钮）
    expect((wrapper.element as HTMLElement).style.display).not.toBe('none')
    expect((wrapper.element as HTMLElement).style.width).toBe('')
    // 顶部行（文件标识 + 文件 tabs + 全屏/收起）完全隐藏，右缘只剩一个展开按钮
    expect(wrapper.find('.right-head').isVisible()).toBe(false)
    expect(wrapper.find('.expand-rail').exists()).toBe(true)
    expect(wrapper.find('.expand-rail .head-btn[aria-label="展开右栏"]').exists()).toBe(true)
    // 主体仍在 DOM（底部终端缓冲不丢）但被 v-show 隐藏
    expect(wrapper.find('.code-view-stub').exists()).toBe(true)
    expect(wrapper.find('.code-view-stub').isVisible()).toBe(false)
    expect(wrapper.find('.split-handle').isVisible()).toBe(false)
  })

  it('收起态挂 collapsed 类、不写内联 width/max-width；展开态全部清除', async () => {
    const wrapper = mountPane(1200, { visible: false })
    await nextTick()
    const el = wrapper.element as HTMLElement
    expect(wrapper.classes()).toContain('collapsed')
    // 完全隐藏后宽度只是展开按钮本身，不再需要 max-width 钳制左区
    expect(el.style.width).toBe('')
    expect(el.style.maxWidth).toBe('')
    await wrapper.setProps({ visible: true })
    await nextTick()
    expect(wrapper.classes()).not.toContain('collapsed')
    expect(el.style.maxWidth).toBe('')
  })

  it('展开态不带 collapsed 类、无 max-width 内联', async () => {
    const wrapper = mountPane(1200, { visible: true })
    await nextTick()
    expect(wrapper.classes()).not.toContain('collapsed')
    expect((wrapper.element as HTMLElement).style.maxWidth).toBe('')
  })

  it('收起态点右缘展开按钮 → emit expand', async () => {
    const wrapper = mountPane(1200, { visible: false })
    await nextTick()
    await wrapper.find('.expand-rail .head-btn[aria-label="展开右栏"]').trigger('click')
    expect(wrapper.emitted('expand')).toHaveLength(1)
  })

  it('展开态无展开按钮（收起按钮在场），点「文件」标识 tab → 翻转文件树折叠态，且不 emit expand', async () => {
    const store = useFilesStore()
    store.collapsed = false
    const wrapper = mountPane(1200, { visible: true })
    await nextTick()
    expect(wrapper.find('.expand-rail').exists()).toBe(false)
    await wrapper.find('.ws-label').trigger('click')
    expect(store.collapsed).toBe(true)
    expect(wrapper.emitted('expand')).toBeUndefined()
    // 再点一次翻回来（双向切换）
    await wrapper.find('.ws-label').trigger('click')
    expect(store.collapsed).toBe(false)
    expect(wrapper.emitted('expand')).toBeUndefined()
  })

  it('展开态点文件 tabs 区 → 不翻转文件树折叠态、不 emit（现状回归）', async () => {
    const store = useFilesStore()
    store.collapsed = false
    const wrapper = mountPane(1200, { visible: true })
    await nextTick()
    await wrapper.find('.file-tabs-stub').trigger('click')
    expect(store.collapsed).toBe(false)
    expect(wrapper.emitted('expand')).toBeUndefined()
  })

  it('「文件」tab hover 提示随树开合变化（收起态顶部行已隐藏，无此 tab）', async () => {
    const store = useFilesStore()
    store.collapsed = false
    const wrapper = mountPane(1200, { visible: true })
    await nextTick()
    expect(wrapper.find('.ws-label').attributes('title')).toBe('折叠文件树')
    store.collapsed = true
    await nextTick()
    expect(wrapper.find('.ws-label').attributes('title')).toBe('展开文件树')
  })

  it('无存量宽度时首展开 = 容器 50%（容器 1200 → 600）', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('600px')
  })

  it('有存量宽度时优先用存量（700）', async () => {
    localStorage.setItem(WIDTH_KEY, '700')
    const wrapper = mountPane(1200)
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('700px')
  })

  it('拖宽上限保证左区至少 400px（容器 1200 → 796 = 1200-400-4）', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 800 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -100000 }))
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('796px')
  })

  it('拖宽下限 320px', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 200 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100000 }))
    await nextTick()
    expect((wrapper.element as HTMLElement).style.width).toBe('320px')
  })

  it('收起态不写 width；容器量到 0 时也不钳制，展开后保留存量宽度', async () => {
    localStorage.setItem(WIDTH_KEY, '680')
    const wrapper = mountPane(0, { visible: false })
    await nextTick()
    // 收起态宽度自适应内容，不落内联 width（存量仍在 useResizablePanel 里）
    expect((wrapper.element as HTMLElement).style.width).toBe('')
    await wrapper.setProps({ visible: true })
    await nextTick()
    // 容器 clientWidth=0 → dynamicMax=Infinity，不钳制，存量 680 原样生效
    expect((wrapper.element as HTMLElement).style.width).toBe('680px')
  })

  it('拖拽结束写入 localStorage', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    wrapper.find('.split-handle').trigger('mousedown', { clientX: 600 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    // 手柄在左缘：向左拖 200px → 右栏 600 → 800（800 ≤ 上限 796 时取 796，
    // 故从 600 拖到 400 的期望是 800 与 796 取小；这里往右拖 200 → 400）
    expect(Number(localStorage.getItem(WIDTH_KEY))).toBeGreaterThan(0)
  })

  it('点收起 emit collapse', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    await wrapper.find('.head-btn[aria-label="收起右栏"]').trigger('click')
    expect(wrapper.emitted('collapse')).toHaveLength(1)
  })

  // 根因：收起后原收起按钮位置立刻被展开入口占据 —— 用户「点收起没反应再点一次」
  // 的第二击落在展开按钮上，<500ms 内把刚收起的又展开，净视觉效果 = 毫无反应。
  // 防抖：visible true→false 后 500ms 内忽略 expand 请求（顶部行 / 展开按钮一视同仁）。
  it('收起后 500ms 内点展开按钮不 emit expand，超过 500ms 恢复', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountPane(1200)
      await nextTick()
      await wrapper.setProps({ visible: false })
      await nextTick()
      // 收起后立即点（用户的第二击）：吞掉
      await wrapper.find('.expand-rail .head-btn[aria-label="展开右栏"]').trigger('click')
      expect(wrapper.emitted('expand')).toBeUndefined()
      // 过防抖窗口后再点：正常展开
      vi.advanceTimersByTime(501)
      await wrapper.find('.expand-rail .head-btn[aria-label="展开右栏"]').trigger('click')
      expect(wrapper.emitted('expand')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('挂载即收起（无本组件内的收起动作）→ 点展开按钮立即 expand，不受防抖影响', async () => {
    const wrapper = mountPane(1200, { visible: false })
    await nextTick()
    await wrapper.find('.expand-rail .head-btn[aria-label="展开右栏"]').trigger('click')
    expect(wrapper.emitted('expand')).toHaveLength(1)
  })

  // 文件树折叠态以用户上一次状态为准（按会话记忆，见 files.test.ts）：
  // 右栏收起→展开不得重置 collapsed，否则用户刚折叠的树一收一展又弹回来。
  it('右栏收起→展开不改文件树折叠状态', async () => {
    const store = useFilesStore()
    store.collapsed = true
    const wrapper = mountPane(1200, { visible: false })
    await nextTick()
    await wrapper.setProps({ visible: true })
    await nextTick()
    expect(store.collapsed).toBe(true)
    // 展开态里手动折叠仍然有效，再收起→展开依旧不动它
    store.collapsed = true
    await wrapper.setProps({ visible: false })
    await nextTick()
    await wrapper.setProps({ visible: true })
    await nextTick()
    expect(store.collapsed).toBe(true)
  })

  it('点全屏 emit toggle-fullscreen；maximized=true 时挂 maximized 类且不写 width', async () => {
    const wrapper = mountPane(1200)
    await nextTick()
    const btn = wrapper.find('.head-btn[title="全屏"]')
    await btn.trigger('click')
    expect(wrapper.emitted('toggle-fullscreen')).toHaveLength(1)
    await wrapper.setProps({ maximized: true })
    expect(wrapper.find('.right-pane.maximized').exists()).toBe(true)
    expect(wrapper.find('.head-btn[title="还原"]').exists()).toBe(true)
    expect((wrapper.element as HTMLElement).style.width).toBe('')
  })

  it('卸载时断开 ResizeObserver', async () => {
    mountPane(1200)
    await nextTick()
    const ro = observers[observers.length - 1]
    expect(ro.disconnect).not.toHaveBeenCalled()
    unmountCurrent()
    expect(ro.disconnect).toHaveBeenCalled()
  })

  it('【复现】点收起后 store.splitOpen 最终为 false（复刻 HomeView 接线）', async () => {
    const store = useFilesStore()
    store.splitOpen = true
    // 与 mountPane 同款 clientWidth spy（harness 需要独立挂载）
    restoreClientWidth?.()
    const spy = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this !== document.body && !!this.querySelector('.right-pane') ? 1200 : 0
    })
    restoreClientWidth = () => spy.mockRestore()
    const container = document.createElement('div')
    document.body.appendChild(container)
    // 复刻 HomeView.vue:248-254 + onCollapseRight + splitOpen watch 的完整接线
    const Harness = defineComponent({
      setup() {
        const rightFullscreen = ref(false)
        watch(() => store.splitOpen, (open) => { if (!open) rightFullscreen.value = false })
        function onCollapseRight() { store.splitOpen = false; rightFullscreen.value = false }
        return { store, rightFullscreen, onCollapseRight }
      },
      render(ctx: { store: ReturnType<typeof useFilesStore>; rightFullscreen: boolean; onCollapseRight: () => void }) {
        return h(RightWorkspacePane, {
          visible: ctx.store.splitOpen,
          maximized: ctx.rightFullscreen,
          onCollapse: ctx.onCollapseRight,
          onToggleFullscreen: () => { ctx.rightFullscreen = !ctx.rightFullscreen },
          onExpand: () => { ctx.store.splitOpen = true },
        })
      },
    })
    const wrapper = mount(Harness, { attachTo: container })
    current = wrapper
    await nextTick()
    expect(store.splitOpen).toBe(true)
    await wrapper.find('.head-btn[aria-label="收起右栏"]').trigger('click')
    await nextTick()
    await nextTick()
    // 若此处为 true 即复现「收起后被翻回」
    expect(store.splitOpen).toBe(false)
    expect((wrapper.find('.right-pane').element as HTMLElement).className).toContain('collapsed')
  })

  // 源码级（jsdom 无布局引擎，flex 溢出行为无法在组件测试里复现）：
  // FileTabs 基础样式 .file-tabs { flex-shrink: 0 }，多 tab 时会把右头部右侧的
  // 全屏/收起按钮推出 .right-head (overflow:hidden) 视口 —— 实测 8 个长名 tab 时
  // 按钮落在 x=2878（窗口宽 1920），elementFromPoint 命中 tab-name，用户点不到收起。
  // 收起态早有豁免（.right-pane.collapsed 前缀），展开态必须同样可收缩。
  it('展开态 .file-tabs 必须可收缩（flex-shrink:1 + min-width:0 不得只挂在 collapsed 选择器下）', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'RightWorkspacePane.vue'), 'utf8')
    const style = src.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? ''
    // 抽出所有命中 .right-head 与 .file-tabs 的规则（选择器 → 声明体）
    const rules = [...style.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), decl: m[2] }))
    const targeting = rules.filter((r) => r.sel.includes('.right-head') && r.sel.includes('.file-tabs'))
    expect(targeting.length, '必须存在 .right-head 下 .file-tabs 的收缩规则').toBeGreaterThan(0)
    // 至少一条不带 .collapsed 前缀（即展开态同样生效）的规则声明了收缩
    const expandedEffective = targeting.filter((r) => !r.sel.includes('.collapsed'))
    const shrinkable = expandedEffective.some(
      (r) => /flex-shrink:\s*1/.test(r.decl) && /min-width:\s*0/.test(r.decl),
    )
    expect(
      shrinkable,
      '展开态需要 flex-shrink:1 + min-width:0（当前只挂在 collapsed 选择器下，多 tab 会把收起按钮推出视口）',
    ).toBe(true)
  })

  // 源码级（jsdom 无布局引擎）：收起态若留在 flex 流里，宽度 = 展开按钮 ~40px，
  // 左侧终端（.session-left flex:1）铺不满。必须 absolute 脱流贴右缘 ——
  // 且宿主 .session-content 要有 position: relative 当定位锚（否则飘到 viewport 右缘，
  // 左侧栏展开/折叠时按钮不再贴内容区右缘）。
  it('收起态必须 absolute 脱离 flex 流，且宿主有 position:relative 锚点', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const rpSrc = readFileSync(join(dir, 'RightWorkspacePane.vue'), 'utf8')
    const style = rpSrc.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? ''
    const collapsedRule = style.match(/\.right-pane\.collapsed\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(
      /position:\s*absolute/.test(collapsedRule),
      '收起态必须 position:absolute（否则 aside 占 ~40px flex 宽度，终端铺不满）',
    ).toBe(true)
    const homeSrc = readFileSync(join(dir, '..', '..', 'views', 'HomeView.vue'), 'utf8')
    expect(
      /\.session-content\s*\{[^}]*position:\s*relative/.test(homeSrc),
      'HomeView 的 .session-content 必须 position:relative（absolute 收起栏的定位锚）',
    ).toBe(true)
  })
})
