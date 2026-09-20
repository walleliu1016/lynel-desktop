// src/main/tasks/runner.ts
// 单次 run 的执行器：spawn claude -p、逐行消费 stream-json、落库、推送、超时、resume 回退。
// 不做调度决策（那是 scheduler 的职责），也不直接建 run 记录（调用方已建好 queued run）。
import { spawn as nodeSpawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import kill from 'tree-kill';
import { ensureTasksDir } from './paths.js';
import { RUN_TIMEOUT_MS } from './schedule.js';
import {
  appendEvent, finishRun, setTaskSession, touchTaskAfterRun,
  type FinishRunPatch, type RunRow, type RunStatus, type TaskRow,
} from './store.js';
import { isResumeMissing, parseStreamLine, type NormalizedEvent } from './streamParse.js';

export interface RunnerCallbacks {
  onEvent(runId: string, events: NormalizedEvent[]): void;
  onFinish(runId: string, status: RunStatus): void;
}

export interface RunnerDeps {
  spawn: typeof nodeSpawn;
  claudeBin(): string;
  now(): number;
  /** 所有任务共用的工作目录。默认走真实设置（建目录 + 落初始 CLAUDE.md），测试注入 tmp 目录。 */
  tasksDir(): string;
}

let deps: RunnerDeps = {
  spawn: nodeSpawn,
  claudeBin: () => 'claude',
  now: () => Date.now(),
  tasksDir: () => ensureTasksDir(),
};

export function setRunnerDeps(patch: Partial<RunnerDeps>): void {
  deps = { ...deps, ...patch };
}

/** stdio 是 ['ignore','pipe','pipe'] —— stdin 为 null，只有 stdout/stderr 可读。 */
type RunProc = ChildProcessByStdio<null, Readable, Readable>;

interface ActiveRun {
  proc: RunProc | null;
  timer: ReturnType<typeof setTimeout> | null;
  seq: number;
  events: NormalizedEvent[];
  pending: string;
  stderrTail: string[];
  finished: boolean;
  resumeAttempted: boolean;
  /** resume 目标缺失的「重建一次」是否已经用过。只允许一次，防止 1s 一轮的 spawn 风暴。 */
  fallbackUsed: boolean;
  exitCode: number | null;
  run: RunRow;
  task: TaskRow;
  cb: RunnerCallbacks;
}

const active = new Map<string, ActiveRun>();

export function activeRunCount(): number {
  return active.size;
}

export function isRunning(runId: string): boolean {
  return active.has(runId);
}

/** 参数构造拆出来单独可测。 */
export function buildSpawnArgs(
  task: TaskRow,
  opts: { sessionInitialized: boolean } = { sessionInitialized: task.sessionInitialized === 1 },
): string[] {
  const sessionFlag = opts.sessionInitialized ? '--resume' : '--session-id';
  return [
    '-p', task.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    sessionFlag, task.sessionId ?? '',
  ];
}

const STDERR_TAIL_MAX = 20;

/** 解析一行 → 落库（payload 存原始行，渲染层自己再解析）→ 返回归一化事件。 */
function recordLine(a: ActiveRun, line: string): NormalizedEvent | null {
  const ev = parseStreamLine(line);
  if (!ev) return null;
  a.events.push(ev);
  try {
    appendEvent(a.run.id, a.seq, ev.type, ev.subtype ?? null, line.replace(/\r$/, ''));
    a.seq += 1;
  } catch {
    /* 落库失败不影响任务本身继续跑 */
  }
  return ev;
}

/** stdout：半行留在 pending 里等下一个 chunk，完整行按「一次 data 一批」推送。 */
function consumeStdout(a: ActiveRun, chunk: string): void {
  a.pending += chunk;
  const lastBreak = a.pending.lastIndexOf('\n');
  if (lastBreak === -1) return;
  const complete = a.pending.slice(0, lastBreak);
  a.pending = a.pending.slice(lastBreak + 1);
  const batch: NormalizedEvent[] = [];
  for (const line of complete.split('\n')) {
    const ev = recordLine(a, line);
    if (ev) batch.push(ev);
  }
  if (batch.length > 0) a.cb.onEvent(a.run.id, batch);
}

/** stderr 也进流（type=stderr），并留最近若干行作为「没有 result 事件时」的 error 文本。 */
function consumeStderr(a: ActiveRun, chunk: string): void {
  const batch: NormalizedEvent[] = [];
  for (const line of chunk.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    a.stderrTail.push(t);
    if (a.stderrTail.length > STDERR_TAIL_MAX) a.stderrTail.shift();
    try {
      appendEvent(a.run.id, a.seq, 'stderr', null, JSON.stringify({ type: 'stderr', text: t }));
      a.seq += 1;
    } catch {
      /* ignore */
    }
    batch.push({ type: 'stderr', text: t });
  }
  if (batch.length > 0) a.cb.onEvent(a.run.id, batch);
}

function finish(a: ActiveRun, status: RunStatus, extra: FinishRunPatch = {}): void {
  if (a.finished) return;
  a.finished = true;
  if (a.timer) clearTimeout(a.timer);
  active.delete(a.run.id);

  const result = a.events.find((e) => e.type === 'result')?.result;
  const errorText =
    status === 'error' && !result && a.stderrTail.length > 0 ? a.stderrTail.join('\n') : null;

  // 首次用 --session-id 成功跑完 → 把会话标记为「已建立」，之后走 --resume。
  // 漏了这一步，下次会拿同一个 id 去「新建」，claude 报 Session ID already in use，上下文再也接不上。
  if (status === 'done' && !a.resumeAttempted && a.task.sessionId) {
    try {
      setTaskSession(a.task.id, a.task.sessionId, true);
    } catch {
      /* 标记失败只影响下次是否 resume，不改变本次结果 */
    }
  }

  // 终态必须先落到内存（active.delete 已完成），DB 写失败也不能让异常逃出事件回调。
  try {
    finishRun(a.run.id, status, {
      resumeUsed: a.resumeAttempted ? 1 : 0,
      exitCode: a.exitCode,
      sessionId: a.run.sessionId,
      ...extra,
      ...(errorText ? { error: errorText } : {}),
    });
    if (status === 'done' || status === 'error') {
      touchTaskAfterRun(a.task.id, deps.now(), status);
    }
  } catch {
    /* DB 不可用：result 已经回调出去，调度侧照常推进 */
  }
  a.cb.onFinish(a.run.id, status);
}

function killTree(a: ActiveRun, status: RunStatus, extra: FinishRunPatch = {}): void {
  try {
    a.proc?.kill();
  } catch {
    /* 已经退出 */
  }
  // tree-kill 杀掉整棵树（win32 的 cmd.exe 包装层、npx/node 子进程不会残留成孤儿）。
  kill(a.proc?.pid ?? 0, () => {
    /* 进程树已尽力；finish 不等待 */
  });
  finish(a, status, extra);
}

function spawnOnce(a: ActiveRun, useResume: boolean): void {
  const args = buildSpawnArgs(a.task, { sessionInitialized: useResume });
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDECODE; // 从 Claude Code 会话内 spawn 会被嵌套守卫挡住

  let proc: RunProc;
  try {
    proc = deps.spawn(deps.claudeBin(), args, {
      cwd: deps.tasksDir(),
      // stdio[0] 必须是 ignore：claude 会等 stdin 最多 3 秒，用 pipe 且不关会一直挂着。
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
      env,
    }) as RunProc;
  } catch (err) {
    finish(a, 'error', { error: `启动 claude 失败: ${String((err as Error)?.message ?? err)}` });
    return;
  }
  a.proc = proc;
  a.resumeAttempted = useResume;

  proc.stdout.setEncoding?.('utf8');
  proc.stdout.on('data', (chunk: string | Buffer) => {
    consumeStdout(a, typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });

  proc.stderr.setEncoding?.('utf8');
  proc.stderr.on('data', (chunk: string | Buffer) => {
    consumeStderr(a, typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });

  // 回退会换掉 `a.proc`，但旧进程的监听器仍挂在事件循环上（同一 emitter 被复用时更直接）。
  // 用 `a.proc === proc` 认「这还是当前进程吗」：旧进程迟到的 error 若走 finish()，
  // 会把新进程的 run 判死、新进程随即变成孤儿。close 由 a.finished 兜住，error 没有。
  proc.on('error', (err: Error) => {
    if (a.finished || a.proc !== proc) return;
    finish(a, 'error', { error: `进程错误: ${err.message}` });
  });

  proc.on('close', (code: number | null) => {
    if (a.finished || a.proc !== proc) return;
    // 冲掉尾部残行（最后一行可能没有换行符）
    if (a.pending.trim()) {
      const ev = recordLine(a, a.pending);
      a.pending = '';
      if (ev) a.cb.onEvent(a.run.id, [ev]);
    }
    a.exitCode = code;

    if (!a.fallbackUsed && isResumeMissing(a.events)) {
      // R2 实测判据命中：resume 目标缺失 → 用 --session-id 重建**一次**。
      // 判据只是事件签名（不看 stderr、也不确认本次真的用了 --resume），
      // 重建后的 run 若再吐出同一个早失败签名（session id 已存在、代理/鉴权早退），
      // 没有闸门就会 1s 一轮地反复 spawn，直到 30 分钟定时器才收场。
      a.fallbackUsed = true;
      // 注意：那个错误 result 里的 session_id 是新的随机 UUID，绝不能写回。
      try {
        setTaskSession(a.task.id, a.task.sessionId ?? '', false);
      } catch {
        /* DB 不可用：标记失败只影响下次是否 resume，不改变本次结果 */
      }
      a.task = { ...a.task, sessionInitialized: 0 };
      a.events = [];
      a.stderrTail = [];
      // 只清了 events/stderrTail/seq 的话，纯空白的尾部残行会漏进新进程的 stdout 缓冲，
      // 旧进程的 exitCode 也会一直挂到下一次 close 才被覆盖。
      a.pending = '';
      a.exitCode = null;
      a.seq = 0;
      spawnOnce(a, false);
      return;
    }

    const result = a.events.find((e) => e.type === 'result')?.result;
    if (result) {
      finish(a, result.isError ? 'error' : 'done', {
        isError: result.isError ? 1 : 0,
        resultSubtype: result.subtype,
        resultText: result.resultText,
        numTurns: result.numTurns,
        durationMs: result.durationMs,
        totalCostUsd: result.totalCostUsd,
        usageJson: JSON.stringify(result.usage),
      });
      return;
    }

    // 没有 result 事件：无论 exit code 是什么都不算成功
    finish(a, 'error', {
      isError: 1,
      error: a.stderrTail.length > 0 ? a.stderrTail.join('\n') : `进程退出码 ${String(code)}，无可解析的 result 事件`,
    });
  });
}

export function startRun(run: RunRow, task: TaskRow, cb: RunnerCallbacks): void {
  const a: ActiveRun = {
    proc: null,
    timer: null,
    seq: 0,
    events: [],
    pending: '',
    stderrTail: [],
    finished: false,
    resumeAttempted: task.sessionInitialized === 1,
    fallbackUsed: false,
    exitCode: null,
    run,
    task,
    cb,
  };
  active.set(run.id, a);

  a.timer = setTimeout(() => {
    if (!active.has(run.id)) return;
    killTree(a, 'timeout', { error: '超过 30 分钟上限，已终止' });
  }, RUN_TIMEOUT_MS);

  spawnOnce(a, task.sessionInitialized === 1);
}

export function cancelRun(runId: string): boolean {
  const a = active.get(runId);
  if (!a) return false;
  killTree(a, 'interrupted', { error: '用户取消' });
  return true;
}

export async function killAllRuns(): Promise<void> {
  const all = [...active.values()];
  await Promise.all(
    all.map(
      (a) =>
        new Promise<void>((resolve) => {
          try {
            a.proc?.kill();
          } catch {
            /* 已经退出 */
          }
          kill(a.proc?.pid ?? 0, () => resolve());
          finish(a, 'interrupted', { error: 'App 退出时仍在运行' });
        }),
    ),
  );
}
