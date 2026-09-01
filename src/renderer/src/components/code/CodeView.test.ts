// 验证 CodeView 子页容器：展开态渲染树面板+编辑器面板，折叠态仅收起树面板、编辑器常驻，拖宽钳制与持久化
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import CodeView from './CodeView.vue'
import { useFilesStore } from '../../stores/files'

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
}))

vi.mock('./FileTree.vue', () => ({ default: { name: 'FileTreeStub', template: '<div class="tree-stub" />' } }))
vi.mock('./FileTabs.vue', () => ({ default: { name: 'FileTabsStub', template: '<div class="tabs-stub" />' } }))
vi.mock('./CodeEditor.vue', () => ({ default: { name: 'CodeEditorStub', template: '<div class="editor-stub" />' } }))
vi.mock('../Icon.vue', () => ({ default: { name: 'IconStub', props: ['name', 'size'], template: '<span :data-icon="name" />' } }))

const WIDTH_KEY = 'lynel:code-tree-width'

describe('CodeView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.body.style.userSelect = ''
  })

  afterEach(() => {
    document.body.style.userSelect = ''
  })

  it('展开态渲染树面板 + 编辑器面板', () => {
    useFilesStore().collapsed = false
    const wrapper = mount(CodeView)
    expect(wrapper.find('.tree-panel').exists()).toBe(true)
    expect(wrapper.find('.editor-panel').exists()).toBe(true)
    expect(wrapper.find('.tree-collapsed').exists()).toBe(false)
  })

  it('折叠态仅收起文件树面板，编辑器面板仍渲染', () => {
    useFilesStore().collapsed = true
    const wrapper = mount(CodeView)
    expect(wrapper.find('.tree-panel').exists()).toBe(false)
    expect(wrapper.find('.tree-collapsed').exists()).toBe(true)
    expect(wrapper.find('.editor-panel').exists()).toBe(true)
    expect(wrapper.find('.tabs-stub').exists()).toBe(true)
    expect(wrapper.find('.editor-stub').exists()).toBe(true)
  })

  it('拖宽超上限时宽度钳制到 600px', async () => {
    useFilesStore().collapsed = false
    const wrapper = mount(CodeView)
    const panel = wrapper.find('.tree-panel')
    wrapper.find('.resize-handle').trigger('mousedown', { clientX: 100 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100000 }))
    await nextTick()
    expect((panel.element as HTMLElement).style.width).toBe('600px')
  })

  it('拖宽超下限时宽度钳制到 240px', async () => {
    useFilesStore().collapsed = false
    const wrapper = mount(CodeView)
    const panel = wrapper.find('.tree-panel')
    wrapper.find('.resize-handle').trigger('mousedown', { clientX: 100 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -100000 }))
    await nextTick()
    expect((panel.element as HTMLElement).style.width).toBe('240px')
  })

  it('拖宽结束写入 localStorage 持久化', async () => {
    useFilesStore().collapsed = false
    const wrapper = mount(CodeView)
    wrapper.find('.resize-handle').trigger('mousedown', { clientX: 100 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    await nextTick()
    expect((wrapper.find('.tree-panel').element as HTMLElement).style.width).toBe('550px')
    expect(localStorage.getItem(WIDTH_KEY)).toBe('550')
  })

  it('挂载时读取 localStorage 预存宽度', () => {
    useFilesStore().collapsed = false
    localStorage.setItem(WIDTH_KEY, '450')
    const wrapper = mount(CodeView)
    expect((wrapper.find('.tree-panel').element as HTMLElement).style.width).toBe('450px')
  })
})
