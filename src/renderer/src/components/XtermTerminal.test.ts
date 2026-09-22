// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import XtermTerminal from './XtermTerminal.vue'
import {
  OpenSessionTerminalSized,
  ResizeTerminal,
} from '../composables/useElectron'

const eventHandlers = new Map<string, (line: string) => void>()
const renderHandlers: Array<() => void> = []
const fitMocks: Array<() => void> = []

class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(cb, 0))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function Terminal() {
    let written = ''
    const bufferLine = {
      translateToString: (trim?: boolean) => {
        const stripped = written.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\s/g, '')
        if (trim) return stripped
        return stripped
      },
    }
    return {
      cols: 120,
      rows: 30,
      options: {},
      loadAddon: vi.fn(),
      open: vi.fn(),
      onData: vi.fn(),
      onRender: (cb: () => void) => {
        renderHandlers.push(cb)
        return { dispose: vi.fn() }
      },
      write: (line: string) => { written += line },
      writeln: vi.fn(),
      refresh: vi.fn(),
      resize: vi.fn(),
      focus: vi.fn(),
      dispose: vi.fn(),
      // FileLinkProvider 在 initializeTerminal 里注册；缺失会让挂载抛 TypeError
      // （jsdom 下没有真实 xterm，mock 必须补齐这个 API）
      registerLinkProvider: vi.fn(),
      buffer: {
        active: {
          length: 1,
          getLine: () => bufferLine,
        },
      },
    }
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function FitAddon() {
    const fit = vi.fn()
    fitMocks.push(fit)
    return { fit }
  }),
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(function WebLinksAddon() {
    return {}
  }),
}))

vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: vi.fn(function SerializeAddon() {
    return { serialize: vi.fn(() => ''), dispose: vi.fn() }
  }),
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('../composables/useElectron', () => ({
  EventsOn: vi.fn((topic: string, handler: (line: string) => void) => {
    eventHandlers.set(topic, handler)
    return vi.fn()
  }),
  OpenSessionTerminalSized: vi.fn(() => Promise.resolve()),
  ResizeTerminal: vi.fn(() => Promise.resolve()),
  OpenExternal: vi.fn(() => Promise.resolve()),
  GetSettings: vi.fn(() => Promise.resolve(null)),
}))

/** rAF 被 stub 成 setTimeout(cb, 0)，initializeTerminal 的异步链（waitForSize/字体/fit 等）
 *  需要多个 macrotask tick 才能完成，这里循环泵足 tick 让整条链跑完。 */
async function flushAsync() {
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('XtermTerminal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    eventHandlers.clear()
    renderHandlers.length = 0
    fitMocks.length = 0
    vi.clearAllMocks()
  })

  it('hides loading only after xterm buffer contains visible content', async () => {
    const wrapper = mount(XtermTerminal, {
      props: {
        sessionId: 'sid-1',
        workdir: '/tmp',
        visible: true,
      },
    })
    const terminalEl = wrapper.find('.xterm-container').element as HTMLElement
    Object.defineProperty(terminalEl, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(terminalEl, 'clientHeight', { value: 500, configurable: true })

    const loading = wrapper.find('[data-testid="terminal-loading"]')
    expect(loading.exists()).toBe(true)

    await wrapper.vm.$nextTick()
    await flushAsync()

    eventHandlers.get('session:sid-1')?.('\x1b[2J\x1b[H')
    renderHandlers.forEach((cb) => cb())
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="terminal-loading"]').exists()).toBe(true)

    eventHandlers.get('session:sid-1')?.('hello world')
    renderHandlers.forEach((cb) => cb())
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="terminal-loading"]').exists()).toBe(false)
  })

  it('does not resize PTY while terminal is hidden', async () => {
    const wrapper = mount(XtermTerminal, {
      props: {
        sessionId: 'sid-1',
        workdir: '/tmp',
        visible: false,
      },
    })
    const terminalEl = wrapper.find('.xterm-container').element as HTMLElement
    Object.defineProperty(terminalEl, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(terminalEl, 'clientHeight', { value: 500, configurable: true })
    await wrapper.vm.$nextTick()

    expect(ResizeTerminal).not.toHaveBeenCalled()

    await wrapper.setProps({ visible: true })
    await wrapper.vm.$nextTick()
    await flushAsync()

    expect(OpenSessionTerminalSized).toHaveBeenCalledWith('sid-1', '/tmp', 120, 30)
    expect(fitMocks[0]).toHaveBeenCalled()
    expect(ResizeTerminal).toHaveBeenCalledWith('sid-1', 120, 30)
  })

  it('startup-error sentinel 展示「错误 + 重试」覆盖层，点重试重新拉起并收起', async () => {
    const wrapper = mount(XtermTerminal, {
      props: { sessionId: 'sid-1', workdir: '/tmp', visible: true },
    })
    const terminalEl = wrapper.find('.xterm-container').element as HTMLElement
    Object.defineProperty(terminalEl, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(terminalEl, 'clientHeight', { value: 500, configurable: true })
    await wrapper.vm.$nextTick()
    await flushAsync()

    // 主进程启动失败：经 session:sid-1 通道发结构化 sentinel
    eventHandlers.get('session:sid-1')?.('{"type":"startup-error","message":"probe 超时 (8000ms)"}')
    await wrapper.vm.$nextTick()

    const errOverlay = wrapper.find('[data-testid="terminal-startup-error"]')
    expect(errOverlay.exists()).toBe(true)
    expect(errOverlay.text()).toContain('probe 超时 (8000ms)')
    expect(wrapper.find('[data-testid="terminal-loading"]').exists()).toBe(false)

    const callsBefore = vi.mocked(OpenSessionTerminalSized).mock.calls.length
    await wrapper.find('[data-testid="startup-retry-btn"]').trigger('click')
    await wrapper.vm.$nextTick()
    // 重试：错误覆盖层收起，IPC 再次发起
    expect(wrapper.find('[data-testid="terminal-startup-error"]').exists()).toBe(false)
    await flushAsync()
    expect(vi.mocked(OpenSessionTerminalSized).mock.calls.length).toBe(callsBefore + 1)
  })

  it('IPC 启动拒绝时同样展示失败覆盖层', async () => {
    vi.mocked(OpenSessionTerminalSized).mockRejectedValueOnce(new Error('无法获得有效的终端尺寸'))
    const wrapper = mount(XtermTerminal, {
      props: { sessionId: 'sid-1', workdir: '/tmp', visible: true },
    })
    const terminalEl = wrapper.find('.xterm-container').element as HTMLElement
    Object.defineProperty(terminalEl, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(terminalEl, 'clientHeight', { value: 500, configurable: true })
    await wrapper.vm.$nextTick()
    await flushAsync()

    const errOverlay = wrapper.find('[data-testid="terminal-startup-error"]')
    expect(errOverlay.exists()).toBe(true)
    expect(errOverlay.text()).toContain('无法获得有效的终端尺寸')
    expect(wrapper.find('[data-testid="terminal-loading"]').exists()).toBe(false)
  })
})
