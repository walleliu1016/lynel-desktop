// 验证 CodeView 子页容器：展开态渲染树面板+编辑器面板，折叠态渲染展开按钮
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'
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

describe('CodeView', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('展开态渲染树面板 + 编辑器面板', () => {
    useFilesStore().collapsed = false
    const wrapper = mount(CodeView)
    expect(wrapper.find('.tree-panel').exists()).toBe(true)
    expect(wrapper.find('.editor-panel').exists()).toBe(true)
    expect(wrapper.find('.tree-collapsed').exists()).toBe(false)
  })

  it('折叠态仅渲染展开按钮', () => {
    useFilesStore().collapsed = true
    const wrapper = mount(CodeView)
    expect(wrapper.find('.tree-panel').exists()).toBe(false)
    expect(wrapper.find('.tree-collapsed').exists()).toBe(true)
  })
})
