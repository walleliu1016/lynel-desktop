// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import TasksTab from './TasksTab.vue'
import { useSettingsStore } from '../../stores/settings'
import { useBotsStore } from '../../stores/bots'
import { useSessionsStore } from '../../stores/sessions'
import { GetSettings, ListBots, ListBotBindings } from '../../composables/useElectron'

vi.mock('../../composables/useElectron', () => ({
  GetSettings: vi.fn(),
  UpdateSettings: vi.fn().mockResolvedValue(undefined),
  ListBots: vi.fn(),
  ListBotBindings: vi.fn(),
  ListSessions: vi.fn().mockResolvedValue([]),
  AdoptSession: vi.fn().mockResolvedValue(undefined),
  CreateSession: vi.fn(),
  SendMessage: vi.fn(),
  RenameSession: vi.fn(),
  BindSessionBot: vi.fn(),
  GetSessionBotBinding: vi.fn(),
  ListTraceRequests: vi.fn().mockResolvedValue([]),
  GetTraceRequest: vi.fn(),
  DiffTraceRequests: vi.fn(),
  ExportTraceRequest: vi.fn(),
  WatchTraceSession: vi.fn(),
  UnwatchTraceSession: vi.fn(),
  EventsOn: vi.fn(() => vi.fn()),
  SaveBot: vi.fn(),
  DeleteBot: vi.fn(),
  GetBotThreshold: vi.fn(),
  SetBotThreshold: vi.fn(),
  GetBotConnectionStatus: vi.fn().mockResolvedValue({}),
}))

/** 简化 BotAddDialog：避免弹窗内部逻辑干扰 */
const BotAddDialogStub = { name: 'BotAddDialog', template: '<div class="bot-add-stub" />' }

const botA = { id: 'bot-a', name: 'A机', botId: 'wx-a', secret: 's', source: 'wecom', chatId: '', createdAt: 1, updatedAt: 1, connected: true }
const botB = { id: 'bot-b', name: 'B机', botId: 'wx-b', secret: 's', source: 'wecom', chatId: '', createdAt: 1, updatedAt: 1, connected: true }

async function mountTab() {
  const pinia = createPinia()
  setActivePinia(pinia)

  vi.mocked(GetSettings).mockResolvedValue({
    tasks_max_concurrency: 6,
    tasks_notify_bot: '',
  } as any)
  // bot-a 已绑定到会话 sid-1；bot-b 空闲
  vi.mocked(ListBots).mockResolvedValue([botA, botB] as any)
  vi.mocked(ListBotBindings).mockResolvedValue({ 'bot-a': 'sid-1' } as any)

  // 模拟设置面板的既有流程：进入前 settings 已加载（cfg 不为 null 才能首帧渲染）
  await useSettingsStore().load()

  const wrapper = mount(TasksTab, {
    global: { stubs: { BotAddDialog: BotAddDialogStub } },
  })
  await flushPromises()
  return { wrapper, pinia }
}

describe('TasksTab 通知机器人选择（与会话绑定互斥）', () => {
  let wrapper: Awaited<ReturnType<typeof mountTab>>['wrapper'] | null = null

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('已绑定到会话的机器人不可选为通知机器人', async () => {
    const { wrapper: w } = await mountTab()
    wrapper = w
    const settings = useSettingsStore()
    const sessions = useSessionsStore()

    // 确认前置：bot-a 确实已绑会话
    expect(sessions.getBotBoundSessionName('bot-a')).toBeTruthy()

    // 打开选择器
    await w.find('button.act-btn').trigger('click')

    // bot-a 那一行：点击后不应写入 tasks_notify_bot
    const rows = w.findAll('.picker-row')
    expect(rows.length).toBe(2)
    const boundRow = rows.find((r) => r.text().includes('A机'))!
    await boundRow.trigger('click')
    await flushPromises()

    // 互斥是双向的：bindSessionBot 拒绑任务通知 bot，
    // 这里也必须拒选已绑会话的 bot，否则造出双身份状态
    expect((settings.cfg as any).tasks_notify_bot).not.toBe('bot-a')

    // 空闲的 bot-b 可以正常选中
    const freeRow = w.findAll('.picker-row').find((r) => r.text().includes('B机'))!
    await freeRow.trigger('click')
    await flushPromises()
    expect((settings.cfg as any).tasks_notify_bot).toBe('bot-b')
  })
})
