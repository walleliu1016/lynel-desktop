// 验证 CodeView 子页容器：展开态渲染树面板+编辑器面板，折叠态仅收起树面板、编辑器常驻，
// 文件树固定 300px（无拖拽 handle），编辑器区始终渲染（editorInSplit 已删除）
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
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
  GitChanged: vi.fn(() => vi.fn()),
}))

vi.mock('./FileTree.vue', () => ({ default: { name: 'FileTreeStub', template: '<div class="tree-stub" />' } }))
vi.mock('./CodeEditor.vue', () => ({ default: { name: 'CodeEditorStub', template: '<div class="editor-stub" />' } }))
vi.mock('../Icon.vue', () => ({ default: { name: 'IconStub', props: ['name', 'size'], template: '<span :data-icon="name" />' } }))

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

  it('折叠态仅收起文件树面板，编辑器面板仍渲染，且不渲染任何展开按钮（竖条已删，展开走「文件」tab）', () => {
    useFilesStore().collapsed = true
    const wrapper = mount(CodeView)
    expect(wrapper.find('.tree-panel').exists()).toBe(false)
    expect(wrapper.find('.tree-collapsed').exists()).toBe(false)
    expect(wrapper.find('[aria-label="展开文件树"]').exists()).toBe(false)
    expect(wrapper.find('.editor-panel').exists()).toBe(true)
    expect(wrapper.find('.editor-stub').exists()).toBe(true)
  })

  it('文件树固定 300px：不再有拖拽 handle，也不写内联宽度', () => {
    useFilesStore().collapsed = false
    const wrapper = mount(CodeView)
    // 只查文件树自己的手柄：BottomPanel/GitPanel 仍有各自的合法拖宽 handle
    expect(wrapper.find('.tree-panel .resize-handle').exists()).toBe(false)
    expect((wrapper.find('.tree-panel').element as HTMLElement).style.width).toBe('')
  })

  it('不再接收 editorInSplit：编辑器区始终渲染', () => {
    useFilesStore().collapsed = false
    const wrapper = mount(CodeView, { props: { editorInSplit: true } as any })
    expect(wrapper.find('.editor-panel').exists()).toBe(true)
    expect(wrapper.find('.editor-stub').exists()).toBe(true)
  })
})
