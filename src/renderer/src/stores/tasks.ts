// 定时任务 Pinia store：任务列表 / 运行历史 / 单次运行流水
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  TasksList, TasksCreate, TasksUpdate, TasksDelete, TasksSetEnabled, TasksRunNow,
  TasksCancel, TasksRuns, TasksRun, TasksRunEvents, TasksPreview,
  OnTasksChanged, OnTasksRunChanged, OnTasksRunEvent,
} from '../composables/useElectron';
import type { EventEnvelope, NormalizedEventDto, RunDto, ScheduleDto, TaskDto } from '../types/tasks';

const RUN_PAGE = 30;

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref<TaskDto[]>([]);
  const activeTaskId = ref<string | null>(null);
  const runs = ref<RunDto[]>([]);
  const runsHasMore = ref(false);
  const activeRunId = ref<string | null>(null);
  const events = ref<EventEnvelope[]>([]);
  const loading = ref(false);
  const loadError = ref<string | null>(null);
  /** 运行流水是否开启底部自动跟随 */
  const followTail = ref(true);

  const activeTask = computed(() => tasks.value.find((t) => t.id === activeTaskId.value) ?? null);
  const activeRun = computed(() => runs.value.find((r) => r.id === activeRunId.value) ?? null);

  async function load() {
    loading.value = true;
    loadError.value = null;
    try {
      tasks.value = (await TasksList()) as TaskDto[];
      if (activeTaskId.value && !tasks.value.some((t) => t.id === activeTaskId.value)) {
        activeTaskId.value = null;
        runs.value = [];
      }
      if (!activeTaskId.value && tasks.value.length > 0) {
        await select(tasks.value[0].id);
      }
    } catch (err) {
      loadError.value = String((err as Error)?.message ?? err);
    } finally {
      loading.value = false;
    }
  }

  async function select(id: string) {
    activeTaskId.value = id;
    activeRunId.value = null;
    events.value = [];
    runs.value = [];
    runsHasMore.value = false;
    await loadRuns(false);
  }

  async function loadRuns(more: boolean) {
    if (!activeTaskId.value) return;
    const before = more ? runs.value.at(-1)?.queuedAt : undefined;
    const page = (await TasksRuns(activeTaskId.value, { limit: RUN_PAGE, ...(before ? { before } : {}) })) as RunDto[];
    runs.value = more ? [...runs.value, ...page] : page;
    runsHasMore.value = page.length === RUN_PAGE;
  }

  async function saveTask(input: { name: string; prompt: string; schedule: ScheduleDto }, id?: string) {
    // 保存后必须让 runs / activeRunId / events 归属「当前选中的任务」：
    // 新建时当前选中切到新任务，更新时仍是被更新的那个任务，
    // 两种情况都要重新 select，否则会残留上一个任务的运行历史。
    let targetId: string | undefined = id;
    if (id) await TasksUpdate(id, input);
    else {
      const created = (await TasksCreate(input)) as TaskDto;
      activeTaskId.value = created.id;
      targetId = created.id;
    }
    await load();
    if (targetId && activeTaskId.value === targetId) await select(targetId);
  }

  async function remove(id: string) {
    await TasksDelete(id);
    if (activeTaskId.value === id) {
      activeTaskId.value = null;
      runs.value = [];
      activeRunId.value = null;
      events.value = [];
    }
    await load();
  }

  async function setEnabled(id: string, on: boolean) {
    await TasksSetEnabled(id, on);
    await load();
  }

  async function runNow(id: string) {
    await TasksRunNow(id);
    if (activeTaskId.value !== id) await select(id);
    else await loadRuns(false);
  }

  async function cancel(runId: string) {
    await TasksCancel(runId);
  }

  /** 打开某次 run 的完整流水：先补齐已有事件，再靠推送增量追加 */
  async function openRun(runId: string) {
    activeRunId.value = runId;
    events.value = [];
    followTail.value = true;
    const initial = (await TasksRunEvents(runId, {})) as EventEnvelope[];
    events.value = initial;
  }

  function closeRun() {
    activeRunId.value = null;
    events.value = [];
  }

  async function preview(schedule: ScheduleDto): Promise<number[]> {
    const res = (await TasksPreview(schedule)) as { nextRuns: number[] };
    return res.nextRuns;
  }

  // ---- 主进程推送 ----
  function bindPush(): () => void {
    const off1 = OnTasksChanged((list) => {
      const next = (list ?? []) as TaskDto[];
      tasks.value = next;
    });
    const off2 = OnTasksRunChanged((run) => {
      const r = run as RunDto | null;
      if (!r) return;
      if (r.taskId === activeTaskId.value) {
        const idx = runs.value.findIndex((x) => x.id === r.id);
        runs.value = idx === -1 ? [r, ...runs.value] : runs.value.map((x) => (x.id === r.id ? r : x));
      }
    });
    const off3 = OnTasksRunEvent((payload) => {
      const p = payload as { runId: string; events: Array<NormalizedEventDto | EventEnvelope> };
      if (!p || p.runId !== activeRunId.value) return;
      const incoming = (p.events ?? []).map((e, i) =>
        ('event' in (e as object)
          ? (e as EventEnvelope)
          : { seq: events.value.length + i, ts: Date.now(), event: e as NormalizedEventDto }),
      );
      events.value = [...events.value, ...incoming];
    });
    return () => {
      off1();
      off2();
      off3();
    };
  }

  return {
    tasks, activeTaskId, runs, runsHasMore, activeRunId, events, loading, loadError, followTail,
    activeTask, activeRun,
    load, select, loadRuns, saveTask, remove, setEnabled, runNow, cancel,
    openRun, closeRun, preview, bindPush,
  };
});
