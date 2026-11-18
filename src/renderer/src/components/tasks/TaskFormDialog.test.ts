// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import TaskFormDialog from './TaskFormDialog.vue'
import type { TaskDto } from '../../types/tasks'

vi.mock('../../composables/useElectron', () => ({
  TasksList: vi.fn().mockResolvedValue([]),
  TasksGet: vi.fn(),
  TasksCreate: vi.fn(),
  TasksUpdate: vi.fn(),
  TasksDelete: vi.fn(),
  TasksSetEnabled: vi.fn(),
  TasksRunNow: vi.fn(),
  TasksCancel: vi.fn(),
  TasksRuns: vi.fn().mockResolvedValue([]),
  TasksRun: vi.fn(),
  TasksRunEvents: vi.fn().mockResolvedValue([]),
  TasksPreview: vi.fn().mockResolvedValue({
    nextRuns: [Date.now() + 3600000],
    summary: '每天 09:00',
    error: null,
  }),
  TasksTemplates: vi.fn().mockResolvedValue([]),
  TasksSaveTemplate: vi.fn(),
  TasksDeleteTemplate: vi.fn(),
  OnTasksChanged: vi.fn(() => vi.fn()),
  OnTasksRunChanged: vi.fn(() => vi.fn()),
  OnTasksRunEvent: vi.fn(() => vi.fn()),
  EventsOn: vi.fn(() => vi.fn()),
}))

/** 简化 TimeoutPicker：这里只验表单接线，控件行为在 TimeoutPicker.test.ts */
const TimeoutPickerStub = {
  name: 'TimeoutPicker',
  props: ['modelValue', 'allowDefault'],
  emits: ['update:modelValue', 'update:valid'],
  template: '<div class="tp-stub" />',
}

function mountForm(mode: 'create' | 'edit', task: TaskDto | null) {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(TaskFormDialog, {
    props: { mode, task },
    global: { stubs: { TimeoutPicker: TimeoutPickerStub, Icon: true } },
  })
}

/** 造一个能通过 canSubmit 的表单内容（名称 + prompt + 合法调度） */
async function fillValid(w: ReturnType<typeof mountForm>) {
  await w.find('input.name-inp').setValue('日报')
  await w.find('textarea').setValue('写日报')
  await flushPromises() // 等 preview mock 返回，nextRuns 非空
}

const baseTask = {
  id: 't1', name: '日报', enabled: true, prompt: '写日报', agent: null,
  sessionId: 's1', sessionInitialized: false,
  scheduleType: 'cron', scheduleExpr: '0 9 * * *', runAt: null,
  scheduleStartAt: null, scheduleEndAt: null,
  nextRunAt: Date.now() + 3600000, lastRunAt: null, lastStatus: null,
  createdAt: 1, updatedAt: 1,
  schedule: '每天 09:00',
  scheduleRaw: { type: 'daily', hour: 9, minute: 0, days: [0, 1, 2, 3, 4, 5, 6], startAt: null, endAt: null },
  timeoutMs: 7200000,
} as unknown as TaskDto

describe('TaskFormDialog 超时字段', () => {
  let w: ReturnType<typeof mountForm> | null = null
  afterEach(() => {
    w?.unmount()
    w = null
  })

  it('新建默认「默认」（null），提交载荷带 timeoutMs', async () => {
    w = mountForm('create', null)
    await fillValid(w)
    expect(w.findComponent(TimeoutPickerStub).props('modelValue')).toBeNull()

    const picker = w.findComponent(TimeoutPickerStub)
    picker.vm.$emit('update:modelValue', 3600000)
    await w.find('button.btn.primary.tall').trigger('click')
    const payload = w.emitted('submit')!.at(-1)![0] as { timeoutMs: number | null }
    expect(payload.timeoutMs).toBe(3600000)
  })

  it('编辑时按 task.timeoutMs 回填', async () => {
    w = mountForm('edit', baseTask)
    await flushPromises()
    expect(w.findComponent(TimeoutPickerStub).props('modelValue')).toBe(7200000)
  })

  it('自定义越界（valid=false）时不能提交', async () => {
    w = mountForm('create', null)
    await fillValid(w)
    const picker = w.findComponent(TimeoutPickerStub)
    picker.vm.$emit('update:valid', false)
    await flushPromises()
    expect(w.find('button.btn.primary.tall').attributes('disabled')).toBeDefined()
  })
})
