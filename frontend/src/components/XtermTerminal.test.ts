// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import XtermTerminal from './XtermTerminal.vue'
import {
  OpenSessionTerminalSized,
  ResizeTerminal,
} from '../composables/useWails'

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
      resize: vi.fn(),
      focus: vi.fn(),
      dispose: vi.fn(),
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

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('../composables/useWails', () => ({
  EventsOn: vi.fn((topic: string, handler: (line: string) => void) => {
    eventHandlers.set(topic, handler)
    return vi.fn()
  }),
  OpenSessionTerminalSized: vi.fn(() => Promise.resolve()),
  ResizeTerminal: vi.fn(() => Promise.resolve()),
}))

describe('XtermTerminal', () => {
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

    const loading = wrapper.find('[data-testid="terminal-loading"]')
    expect(loading.exists()).toBe(true)

    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))

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

    expect(OpenSessionTerminalSized).toHaveBeenCalledWith('sid-1', '/tmp', 120, 30)
    expect(fitMocks[0]).toHaveBeenCalled()
    expect(ResizeTerminal).toHaveBeenCalledWith('sid-1', 120, 30)
  })
})
