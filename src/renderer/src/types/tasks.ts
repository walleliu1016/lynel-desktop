// src/renderer/src/types/tasks.ts
// 渲染侧类型。与主进程 store 的 row 形状一一对应（主进程索引 store.ts 的 TaskRow / RunRow）。
// 注意：渲染层不解析 NDJSON —— NormalizedEventDto 是主进程 streamParse 的产物。

export type ScheduleType = 'cron' | 'once';
export type RunStatus =
  | 'queued' | 'running' | 'done' | 'error' | 'timeout' | 'skipped' | 'interrupted';

export type IntervalUnit = 'minute' | 'hour' | 'day' | 'month';

/** 生效区间（可选的起止时间戳）。不在 cron 里表达，由主进程交给 croner 的 startAt / stopAt。 */
export interface ScheduleWindow {
  startAt: number | null;
  endAt: number | null;
}

/** 与主进程 schedule.ts 的 Schedule 一一对应。渲染层**不自己构造 cron**：
 *  编辑时用 task.scheduleRaw 回填，预览/摘要由 tasks:preview 返回，避免两份模板逻辑漂移。 */
export type ScheduleDto =
  | ({ type: 'daily'; hour: number; minute: number; days: number[] } & ScheduleWindow)
  | ({
      type: 'interval';
      n: number;
      unit: IntervalUnit;
      days: number[];
      hour: number;
      minute: number;
      /** 仅 unit='month' 用：每 N 个月的几号 */
      dayOfMonth: number;
    } & ScheduleWindow)
  | { type: 'once'; runAt: number }
  | ({ type: 'cron'; expression: string } & ScheduleWindow);

export interface TaskDto {
  id: string;
  name: string;
  enabled: boolean;
  prompt: string;
  agent: string | null;
  sessionId: string | null;
  sessionInitialized: boolean;
  scheduleType: ScheduleType;
  scheduleExpr: string | null;
  runAt: number | null;
  scheduleStartAt: number | null;
  scheduleEndAt: number | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  createdAt: number;
  updatedAt: number;
  /** 人类可读摘要，如「每天 09:00」 */
  schedule: string;
  scheduleRaw: ScheduleDto;
}

export interface RunDto {
  id: string;
  taskId: string;
  trigger: string;
  status: RunStatus;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  sessionId: string | null;
  resumeUsed: number | null;
  exitCode: number | null;
  isError: number | null;
  resultSubtype: string | null;
  resultText: string | null;
  numTurns: number | null;
  durationMs: number | null;
  totalCostUsd: number | null;
  usageJson: string | null;
  error: string | null;
  eventCount: number;
}

export interface ResultSummaryDto {
  subtype: string;
  isError: boolean;
  resultText: string;
  numTurns: number;
  durationMs: number;
  totalCostUsd: number;
  stopReason: string | null;
  terminalReason: string | null;
  permissionDenials: string[];
  usage: Record<string, number>;
}

export type NormalizedBlockDto =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export interface NormalizedEventDto {
  type: 'system' | 'assistant' | 'user' | 'result' | 'stderr';
  subtype?: string;
  messageId?: string;
  parentToolUseId?: string | null;
  blocks?: NormalizedBlockDto[];
  toolResult?: { toolUseId: string; content: string; isError: boolean };
  init?: {
    model: string; cwd: string; toolCount: number;
    claudeCodeVersion: string; permissionMode: string; failedMcpServers: string[];
  };
  hook?: { name: string; ok: boolean };
  result?: ResultSummaryDto;
  text?: string;
}

/** 已带 seq 的事件（IPC 返回的形状） */
export interface EventEnvelope {
  seq: number;
  ts: number;
  event: NormalizedEventDto;
}

export type StreamItem =
  | { kind: 'init'; model: string; cwd: string; toolCount: number; version: string; failedMcpServers: string[] }
  | { kind: 'hook'; name: string; ok: boolean }
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      summary: string;
      status: 'ok' | 'error' | 'running';
      input: Record<string, unknown>;
      output?: string;
      subagent: boolean;
      /** 仅 Edit / Write：新增与删除的行数 */
      delta?: { add: number; del: number };
    }
  | { kind: 'stderr'; text: string }
  | {
      kind: 'result';
      summary: ResultSummaryDto;
      /** summary.resultText 与紧邻上方的助手正文完全重复（result.result 本来就是最后一条 assistant
       *  文本），渲染层据此不再把同一段话显示第二遍。见 utils/tasks.ts 的 trailingTextRun。 */
      textRepeatsAbove: boolean;
    };

/** 用户自建模板（主进程 templates.ts 落库，渲染层只展示）。 */
export interface TaskTemplateDto {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  prompt: string;
  schedule: ScheduleDto;
  createdAt: number;
}

/** tasks:preview 的返回：接下来 3 次 + 人读摘要 + 非法原因。 */
export interface PreviewResult {
  nextRuns: number[];
  summary: string;
  error: string | null;
}
