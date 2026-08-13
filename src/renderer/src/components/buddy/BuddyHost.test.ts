// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import BuddyHost from './BuddyHost.vue'
import { useSettingsStore } from '../../stores/settings'

// mock IPC 转发层，避免依赖 window.electronAPI（路径从 components/buddy 回到 useElectron）
vi.mock('../../composables/useElectron', () => ({
  GetSettings: vi.fn().mockResolvedValue(null),
  UpdateSettings: vi.fn().mockResolvedValue(undefined),
  ListSessions: vi.fn().mockResolvedValue([]),
  AdoptSession: vi.fn().mockResolvedValue(undefined),
  CreateSession: vi.fn(),
  SendMessage: vi.fn(),
  RenameSession: vi.fn(),
  BindSessionBot: vi.fn(),
  GetSessionBotBinding: vi.fn(),
  ListBots: vi.fn().mockResolvedValue([]),
  ListBotBindings: vi.fn().mockResolvedValue({}),
  ListTraceRequests: vi.fn().mockResolvedValue([]),
  GetTraceRequest: vi.fn(),
  DiffTraceRequests: vi.fn(),
  ExportTraceRequest: vi.fn(),
  WatchTraceSession: vi.fn(),
  UnwatchTraceSession: vi.fn(),
  EventsOn: vi.fn(() => vi.fn()),
}))

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(cb, 0))

describe('BuddyHost', () => {
  let wrapper: ReturnType<typeof mount> | null = null

  beforeEach(async () => {
    setActivePinia(createPinia())
    const settings = useSettingsStore()
    await settings.load() // GetSettings → null → 默认配置
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.clearAllMocks()
  })

  /** 设置 buddy 相关配置（默认启用） */
  function configure(buddyCustomAscii: string, buddyEnabled = true) {
    const settings = useSettingsStore()
    settings.cfg = { ...settings.cfg!, buddyEnabled, buddyCustomAscii }
  }

  it('未启用时不渲染 Buddy', () => {
    configure('', false)
    wrapper = mount(BuddyHost)
    expect(wrapper.find('pre').exists()).toBe(false)
  })

  it('合法自定义 ASCII 覆盖角色帧', () => {
    const art = ' /\\_/\\ \n( o.o )'
    configure(art)
    wrapper = mount(BuddyHost)
    const pre = wrapper.find('pre')
    expect(pre.exists()).toBe(true)
    // 用 textContent 而非 text()：VTU 的 text() 会 trim，剥掉 ASCII 帧行内空格
    expect(pre.element.textContent).toBe(art)
  })

  it('自定义 ASCII 首尾空行被剔除，中部空行保留', () => {
    // 首尾各 1 空行、中部 1 空行；渲染应去掉首尾空行，保留中部构图空行
    configure('\n /\\_/\\ \n\n( o.o )\n')
    wrapper = mount(BuddyHost)
    const pre = wrapper.find('pre')
    expect(pre.element.textContent).toBe(' /\\_/\\ \n\n( o.o )')
  })

  it('自定义 ASCII 全为空白时回退角色画', () => {
    configure('   \n\n ')
    wrapper = mount(BuddyHost)
    const pre = wrapper.find('pre')
    // 剔除首尾空行后空数组 → 回退 duck idle 帧
    expect(pre.element.textContent).toBe(['  __  ', ' <(o_o)>', '   \\_/ ', '  /| |\\ '].join('\n'))
  })

  it('非法自定义 ASCII（超行数）回退角色画', () => {
    const tooMany = Array.from({ length: 41 }, () => 'x').join('\n')
    configure(tooMany)
    wrapper = mount(BuddyHost)
    const pre = wrapper.find('pre')
    expect(pre.element.textContent).toBe(['  __  ', ' <(o_o)>', '   \\_/ ', '  /| |\\ '].join('\n'))
  })
})
