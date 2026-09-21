// run / task 状态的展示口径。此前 TaskList、TaskDetailPane、RunStreamView 各写一份
// LABELS / ICONS 映射，新增状态（如 missed）时总有组件漏掉、显示成原始英文。
export const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  done: '成功',
  error: '失败',
  timeout: '超时',
  skipped: '已跳过',
  interrupted: '已中断',
  // 单次任务的档期过了补救窗口：scheduler 写 lastStatus='missed' 但不更新 lastRunAt
  missed: '已过期',
};

export const STATUS_ICONS: Record<string, string> = {
  queued: 'clock',
  running: 'activity',
  done: 'check',
  error: 'warning',
  timeout: 'clock',
  skipped: 'slash',
  interrupted: 'slash',
  missed: 'clock',
};

export const statusLabel = (s: string | null | undefined): string =>
  s ? STATUS_LABELS[s] ?? s : '—';

export const statusIcon = (s: string | null | undefined): string =>
  (s && STATUS_ICONS[s]) || 'clock';

/** 终态里的「坏」状态：列表与详情用它决定是否染红 */
export const BAD_STATUSES = new Set(['error', 'timeout', 'interrupted']);
