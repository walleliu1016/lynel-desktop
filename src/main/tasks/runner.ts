// src/main/tasks/runner.ts
// 单次 run 的执行器：spawn claude -p、逐行消费 stream-json、落库、推送、超时、resume 回退。
// 不做调度决策（那是 scheduler 的职责），也不直接建 run 记录（调用方已建好 queued run）。
import { spawn as nodeSpawn, type ChildProcessByStdio } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import kill from 'tree-kill';
import { resolveBin } from '../pty.js';
import { ensureTasksDir } from './paths.js';
import { RUN_TIMEOUT_MS } from './schedule.js';
import {
  appendEvent, clearRunEvents, finishRun, setTaskSession, touchTaskAfterRun,
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

/**
 * 从 npm 生成的 shim 里取出它真正执行的原生目标。
 *
 * npm 的 shim 是模板化的，目标路径一定被引号包着、且带 `node_modules`：
 *   claude.cmd → `"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*`
 *   claude     → `exec "$basedir/node_modules/@anthropic-ai/claude-code/bin/claude.exe"   "$@"`
 * 把 `%dp0%` / `$basedir`（都是 shim 自身目录）代进去即可。只接受原生可执行文件
 * （.exe/.com）—— 认不出来（含旧版 `cli.js` 形态）就返回 null，调用方据此判失败，不套壳启动。
 */
function resolveShimTarget(shimPath: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(shimPath, 'utf8');
  } catch {
    return null;
  }
  const dir = path.dirname(shimPath);
  const hit = /"([^"\r\n]*node_modules[\\/][^"\r\n]*)"/.exec(text);
  if (!hit) return null;
  const raw = hit[1]
    .replace(/%~?dp0%?/gi, dir) // cmd shim
    .replace(/\$basedir|\$\{basedir\}/gi, dir); // sh shim
  if (!/\.(exe|com)$/i.test(raw)) return null;
  const abs = path.resolve(raw);
  return fs.existsSync(abs) ? abs : null;
}

/**
 * 认不出原生目标时，尽力给一条可照抄的候选路径：npm 全局装的 claude 原生 exe 固定落在
 * `<shim 所在目录>\node_modules\@anthropic-ai\claude-code\bin\claude.exe`，而 shim 就在 npm prefix 下。
 * 只在文件真的存在时才返回（不凭空编一条路径让用户去猜）。npm prefix 不固定（nvm / 自定义 --prefix），
 * 所以按 shim 目录推导而不是硬编码 %APPDATA%\npm。
 */
function nativeExeHint(resolved: string): string | null {
  const candidate = path.join(
    path.dirname(resolved), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe',
  );
  return fs.existsSync(candidate) ? candidate : null;
}

/** buildSpawnCommand 的结果：ok:false 表示本平台无法「不套壳」启动，调用方必须直接判失败、绝不 spawn。 */
export type SpawnCommand =
  | { ok: true; file: string; args: string[] }
  | { ok: false; error: string };

/**
 * 决定「spawn 什么」（file + args）。与参数构造分开，便于单测直接断言。
 *
 * Windows 上 claude 是 npm 装的 shim，两层坑：
 *   1. 裸名 `claude` → Node 不做 PATHEXT 解析 → ENOENT；指向 `claude.cmd` → Node ≥18.20/20.12/21.7
 *      对 .cmd/.bat 无 shell 的 spawn 加固（CVE-2024-27980）→ 同步抛 EINVAL。所以必须解析。
 *   2. 解析出来后**不能**照搬 pty.ts 的 `cmd.exe /d /c <shim>`：那条路只在无 detached 时成立。
 *      本执行器带 `detached: true`（DETACHED_PROCESS），实测此时**只有直接子进程**的
 *      stdout/stderr 还能进管道，孙进程全丢 —— 实测 cmd.exe / powershell.exe / `start /b /wait` /
 *      `shell: true` 四种包装全部拿到空输出（对照组：同样参数下 `where.exe node` 走 cmd 包装
 *      也是空，不 detached 则有输出；而原生 claude.exe 直接 spawn 则正常打印版本号）。
 *      故 win32 上的正解是「让 claude 自己当直接子进程」：解析出 shim 背后的原生 exe 直接 spawn。
 *   3. 解析不出原生目标（非 npm 模板的自定义包装、旧版 cli.js 形态、PATH 里根本没有）→ **不 spawn**，
 *      返回 ok:false 交调用方判失败。套壳启动不是「降级」，而是更坏的失败：进程照样起来、
 *      claude 照样以 bypassPermissions 真实执行并产生副作用，但 stdout 全丢 → run 记成
 *      「exit 0，无可解析的 result 事件」的 error 且事件流为空，用户看到失败会重跑，副作用翻倍。
 * 非 win32 保持原样（裸名交给内核按 PATH 解析），不改变 POSIX 行为。
 */
export function buildSpawnCommand(
  bin: string,
  args: string[],
  plat: NodeJS.Platform = process.platform,
): SpawnCommand {
  if (plat !== 'win32') return { ok: true, file: bin, args };
  const resolved = resolveBin(bin, process.env as Record<string, string>);
  if (resolved) {
    const native = /\.(exe|com)$/i.test(resolved) ? resolved : resolveShimTarget(resolved);
    if (native) return { ok: true, file: native, args };
  }
  return { ok: false, error: unresolvableError(bin, resolved) };
}

/** 解析失败的错误文案。要能直接落到 runs.error 让 UI 显示，并给出可执行的下一步。 */
function unresolvableError(bin: string, resolved: string | null): string {
  const hint = resolved ? nativeExeHint(resolved) : null;
  const advice = hint
    ? `请在设置里把「Claude 路径」(claude_path) 指向原生可执行文件：${hint}`
    : '请在设置里把「Claude 路径」(claude_path) 指向原生 claude.exe（npm 全局安装目录为 `npm prefix -g` 的输出，'
      + '原生 exe 在其 node_modules\\@anthropic-ai\\claude-code\\bin\\ 下），或先执行 `npm i -g @anthropic-ai/claude-code`。';
  const found = resolved ? `只找到 ${resolved}` : `在 PATH 里没有找到「${bin}」`;
  return `无法启动 claude：${found}，且没能解析出它背后的原生可执行文件（.exe/.com）。`
    + '本次运行未启动任何进程（用 cmd.exe 套壳启动会丢失全部输出，而 claude 仍会真实执行并产生副作用）。'
    + advice;
}

/**
 * `runs.resume_used` 的三态（列本身可空，不需要迁移）：
 *   1    = 本次真的用了 `--resume`；
 *   0    = resume 目标缺失（isResumeMissing 命中）→ 回退成 `--session-id` 重建过一次；
 *   null = 其它情况 —— 尤其是**首次运行**（session_initialized=0，本来就没得 resume）。
 * 渲染层的「会话已重建」只在 === 0 时亮，首跑若写 0 会误报。
 */
function resumeUsedValue(a: ActiveRun): number | null {
  if (a.resumeAttempted) return 1;
  return a.fallbackUsed ? 0 : null;
}

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

  // 首次用 --session-id 起过进程 → 把会话标记为「已建立」，之后走 --resume。
  // 判据是「claude 真的把会话建起来了」，**不是**「本次跑成功了」：只认 done 的话，
  // 首跑只要以 error / timeout / interrupted 收场（用户点取消、30 分钟超时、error_max_turns、
  // API 报错、App 中途退出）就永远不置位，下次又拿同一个 id 去「新建」，claude 报
  // Session ID already in use → 任务从此永久失败且无自愈路径。
  // 非回退路径上解析出过任何事件（含 stderr）就说明进程真的起来了、会话已落盘；
  // 纯 spawn 失败等「一个事件都没有」的 never-started run 仍留在 0。
  if (!a.resumeAttempted && a.task.sessionId && a.events.length > 0) {
    try {
      setTaskSession(a.task.id, a.task.sessionId, true);
    } catch {
      /* 标记失败只影响下次是否 resume，不改变本次结果 */
    }
  }

  // 终态必须先落到内存（active.delete 已完成），DB 写失败也不能让异常逃出事件回调。
  try {
    finishRun(a.run.id, status, {
      resumeUsed: resumeUsedValue(a),
      exitCode: a.exitCode,
      sessionId: a.run.sessionId,
      ...extra,
      ...(errorText ? { error: errorText } : {}),
    });
    // 所有终态都回写 tasks.last_run_at / last_status（spec §5.3）：只写 done / error 会让
    // 超时、被取消的任务在列表里一直挂着上一次的「成功」，「上次失败」筛选与详情页的
    // st-* 分支对这两个状态永远不可达。runner 不产生 skipped（那是调度器「从未启动」的结论，
    // 不经这里），故无需排除。
    if (status !== 'skipped') {
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

  // win32 下解析出的是 shim 背后的原生 claude.exe（见 buildSpawnCommand），args 不变。
  // ok:false = 解析不到原生目标：这里**直接判失败、不 spawn** —— 套壳启动虽然能把进程拉起来，
  // 但在 detached 下拿不到任何输出（run 会记成「exit 0，无 result 事件」的 error），
  // 而 claude 仍会以 bypassPermissions 真实执行并产生副作用，用户重跑等于副作用翻倍。
  const cmd = buildSpawnCommand(deps.claudeBin(), args);
  if (!cmd.ok) {
    finish(a, 'error', { error: cmd.error });
    return;
  }
  const { file, args: spawnArgs } = cmd;

  let proc: RunProc;
  try {
    proc = deps.spawn(file, spawnArgs, {
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
      // 必须先把第一趟已落库的事件（seq 0..N）删掉再归零计数器：直接 a.seq = 0 会让重建这趟的
      // 每一次 appendEvent 都撞 PRIMARY KEY (run_id, seq)，而 recordLine 的 catch 会吞掉异常、
      // `a.seq += 1` 又在那个 try 里 —— 于是整趟重建一条事件都存不进去，run 报成功而流水永久空白
      // （UI 只剩第一趟被放弃的 error 结果）。只归零 seq 而不删行同样不对：那是把两趟的流水混在一起。
      try {
        clearRunEvents(a.run.id);
      } catch {
        /* DB 不可用：这趟流水仍会断，但不影响任务本身继续跑 */
      }
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

/**
 * 取消某个任务当前所有在跑的 run（删除任务前必调）。返回真正被取消的个数。
 *
 * 为什么必须做：`deleteTask` 会连带删掉该任务的 runs / run_events（早前的级联修复），
 * 但内存里的 ActiveRun 和它的子进程并不知情 —— run 行没了，UI 再也给不出「取消」入口，
 * `finishRun` 变成 0 行 UPDATE，而 `appendEvent` 还会继续往已删除的 run_id 里写
 * （表间无外键）→ 永久孤儿行 + 一个用户看不见也杀不掉的 claude 进程。
 *
 * 先取名再逐个 cancelRun（内部按 id 重新查表）：某个 run 恰好在这两步之间跑完时自然跳过。
 */
export function cancelTaskRuns(taskId: string): number {
  const ids = [...active.values()].filter((a) => a.task.id === taskId).map((a) => a.run.id);
  let cancelled = 0;
  for (const id of ids) {
    if (cancelRun(id)) cancelled += 1;
  }
  return cancelled;
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
