// src/renderer/src/types/tasks.ts
// 渲染侧类型。与主进程 store 的 row 形状一一对应（主进程索引 store.ts 的 TaskRow / RunRow）。
// 注意：渲染层不解析 NDJSON —— NormalizedEventDto 是主进程 streamParse 的产物。

export type ScheduleType = 'cron' | 'once';
export type RunStatus =
  | 'queued' | 'running' | 'done' | 'error' | 'timeout' | 'skipped' | 'interrupted';

export type ScheduleDto =
  | { type: 'cron'; expression: string }
  | { type: 'once'; runAt: number };

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
  | { kind: 'result'; summary: ResultSummaryDto };
