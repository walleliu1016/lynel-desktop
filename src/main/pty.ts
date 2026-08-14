import * as pty from 'node-pty';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { getLogger } from './log.js';

export enum PtyMode {
  Auto = 'auto',
  New = 'new',
  Resume = 'resume',
}

export interface PtySize {
  cols: number;
  rows: number;
}

export interface PtyProcess {
  pid: number;
  onData: (cb: (data: string) => void) => void;
  /** onExit 回调收到详细退出信息（含运行时长、输出尾部、bin 路径诊断），便于上层区分"启动失败 vs 正常退出" */
  onExit: (cb: (info: PtyExitInfo) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
}

/** PTY 退出时的诊断信息。运行时长 + 输出尾部对识别"早期失败"至关重要：
 *  node-pty 的早期 spawn 失败（ENOENT / EACCES）通常 24~ms 内退出且 buffer 几乎为空，
 *  需要用 spawn 时长 + 输出长度共同判定，再 toast 详细诊断给用户。 */
export interface PtyExitInfo {
  /** 进程退出码；node-pty spawn 失败时通常是 1，但部分平台是 127 / 126 */
  code: number;
  /** 从 spawn 到 exit 的毫秒数；< 2000ms 基本是早期失败 */
  durationMs: number;
  /** 退出前 PTY 累计输出尾部最多 4KB；用于把 Claude 启动时的报错（如 conversation not found、ENOENT）一起带到 toast */
  outputTail: string;
  /** spawn 时实际使用的 bin 路径（已 resolve）；可能是 'claude' 没解析到绝对路径 */
  resolvedBin: string;
  /** spawn 前 resolvedBin 是否存在（绝对路径才检查）；false 说明 binary 找不到 */
  binExists: boolean | 'unknown';
  /** 传给 spawn 的全部 args（--resume sid --settings xxx 等），诊断专用 */
  spawnArgs: string[];
  /** 启动 cwd */
  cwd: string;
}

// macOS GUI 应用从 Finder 启动时 PATH 不完整，这里用用户的 login shell 解析完整环境变量，
// 确保能找到通过 npm/homebrew 安装的 claude。
let cachedDarwinEnv: Record<string, string> | null = null;
let darwinEnvLoading: Promise<Record<string, string>> | null = null;

const DARWIN_ENV_CACHE_PATH = path.join(os.homedir(), '.lynel-desktop', 'darwin-env.json');

interface DarwinEnvCache {
  version: 1;
  shell: string;
  env: Record<string, string>;
  sources: Record<string, number>; // file mtime map
}

function readShellEnvCache(): DarwinEnvCache | null {
  try {
    const raw = fs.readFileSync(DARWIN_ENV_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as DarwinEnvCache;
    if (parsed.version !== 1 || !parsed.env || !parsed.sources) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeShellEnvCache(cache: DarwinEnvCache): void {
  try {
    fs.mkdirSync(path.dirname(DARWIN_ENV_CACHE_PATH), { recursive: true });
    fs.writeFileSync(DARWIN_ENV_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err: any) {
    getLogger().warn(`[pty] failed to write darwin env cache: ${err?.message || err}`);
  }
}

function shellEnvSources(shell: string): Record<string, number> {
  const candidates = [
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.zprofile'),
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.bash_profile'),
    path.join(os.homedir(), '.profile'),
  ];
  const sources: Record<string, number> = {};
  for (const f of candidates) {
    try {
      sources[f] = fs.statSync(f).mtimeMs;
    } catch {
      // file not exists, skip
    }
  }
  return sources;
}

function isCacheValid(cache: DarwinEnvCache, shell: string): boolean {
  const current = shellEnvSources(shell);
  const keys = new Set([...Object.keys(current), ...Object.keys(cache.sources)]);
  for (const k of keys) {
    if ((current[k] ?? 0) !== (cache.sources[k] ?? 0)) return false;
  }
  return true;
}

function parseEnvOutput(out: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      env[line.slice(0, idx)] = line.slice(idx + 1);
    }
  }
  return env;
}

function resolveShellEnvSync(): Record<string, string> {
  if (os.platform() !== 'darwin') return {};
  if (cachedDarwinEnv) return cachedDarwinEnv;

  const shell = process.env.SHELL || '/bin/zsh';
  const logger = getLogger();
  logger.info(`[pty] resolving darwin shell env via ${shell}`);

  const cached = readShellEnvCache();
  if (cached && cached.shell === shell && isCacheValid(cached, shell)) {
    cachedDarwinEnv = cached.env;
    logger.info(`[pty] using cached darwin env (PATH=${cached.env.PATH?.slice(0, 120)}...)`);
    return cached.env;
  }

  try {
    const out = execFileSync(shell, ['-ilc', 'env'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const env = parseEnvOutput(out);
    cachedDarwinEnv = env;
    writeShellEnvCache({ version: 1, shell, env, sources: shellEnvSources(shell) });
    logger.info(`[pty] resolved and cached PATH=${env.PATH?.slice(0, 120)}...`);
    return env;
  } catch (err: any) {
    logger.warn('[pty] failed to resolve darwin shell env:', err?.message || err);
    return {};
  }
}

export async function resolveShellEnvAsync(): Promise<Record<string, string>> {
  if (os.platform() !== 'darwin') return {};
  if (cachedDarwinEnv) return cachedDarwinEnv;
  if (darwinEnvLoading) return darwinEnvLoading;

  darwinEnvLoading = (async () => {
    const shell = process.env.SHELL || '/bin/zsh';
    const logger = getLogger();
    logger.info(`[pty] async resolving darwin shell env via ${shell}`);

    const cached = readShellEnvCache();
    if (cached && cached.shell === shell && isCacheValid(cached, shell)) {
      cachedDarwinEnv = cached.env;
      logger.info(`[pty] using cached darwin env (PATH=${cached.env.PATH?.slice(0, 120)}...)`);
      return cached.env;
    }

    return new Promise<Record<string, string>>((resolve) => {
      execFile(shell, ['-ilc', 'env'], {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      }, (err, stdout) => {
        if (err) {
          getLogger().warn('[pty] async resolve darwin shell env failed:', err?.message || err);
          resolve({});
          return;
        }
        const env = parseEnvOutput(stdout);
        cachedDarwinEnv = env;
        writeShellEnvCache({ version: 1, shell, env, sources: shellEnvSources(shell) });
        getLogger().info(`[pty] async resolved and cached PATH=${env.PATH?.slice(0, 120)}...`);
        resolve(env);
      });
    });
  })();

  return darwinEnvLoading;
}

export function preloadShellEnv(): Promise<Record<string, string>> {
  return resolveShellEnvAsync();
}

function resolveShellEnv(): Record<string, string> {
  return resolveShellEnvSync();
}

// 如果 bin 是相对路径（如 'claude'），在解析后的 PATH 中查找绝对路径，
// 避免 node-pty 因 PATH 不完整找不到命令而直接退出。
// 找不到时返回 null：node-pty 的 forkpty 在 macOS 上失败时静默 exit code=1
// 拿不到 errno，不行的话让上层主动 throw 明确错误。
function resolveBin(bin: string, env: Record<string, string>): string | null {
  if (path.isAbsolute(bin) || bin.includes(path.sep)) return bin;
  const pathEnv = env.PATH || process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // continue searching
    }
  }
  return null;
}

/** stat resolvedBin，识别"命令真实存在但路径错误"这种 silent 失败 */
function statBin(bin: string): boolean | 'unknown' {
  if (!bin) return false;
  if (!path.isAbsolute(bin) && !bin.includes(path.sep)) return 'unknown';
  try {
    return fs.statSync(bin).isFile();
  } catch {
    return false;
  }
}

/**
 * Spawn 前 sync 探测一次 bin 是否可执行。
 *
 * 核心动机：node-pty 在 macOS 用 forkpty(3)，子进程 exec 失败时直接 exit(1)，
 * 父进程只拿到 onExit=1，**没有 ENOENT/EACCES/EPERM 等 errno**——forkpty 之后
 * PTY 尚未就绪，子进程 stderr 直接进 /dev/null，用户看到"无任何输出 code=1"
 * 完全没法定位。这是 lynel-desktop 在 macOS 上偶发"启动失败"的关键差异点：
 * ccglass 用 child_process.spawn + stdio:inherit，子进程能在 exit 前把 ENOENT
 * 写到 stderr。
 *
 * 这里用 execFileSync 同步探测：拿到明确 errno 就立即 throw，让上层走 toast
 * + log 给用户可读诊断；探测成功只多 ~100ms 启动延迟，性价比高。
 *
 * Windows 上 `claude` 通常是 `.cmd` shim（Node 不直接支持），用 `cmd.exe /c` 包一层。
 */
function probeBin(resolvedBin: string, env: Record<string, string>, label: string, bin: string): void {
  const logger = getLogger();
  const PLATFORM = process.platform;
  const isWin = PLATFORM === 'win32';
  const runOnce = (timeout: number): void => {
    if (isWin) {
      // Windows: claude 在 PATH 里通常是 claude.cmd shim；execFileSync 不支持
      // .cmd/.bat/.ps1，需要经 cmd.exe 调用
      execFileSync('cmd.exe', ['/d', '/c', resolvedBin, '--version'], {
        stdio: 'ignore',
        timeout,
        windowsHide: true,
        env,
      });
    } else {
      execFileSync(resolvedBin, ['--version'], {
        stdio: 'ignore',
        timeout,
        env,
      });
    }
  };
  try {
    runOnce(3000);
  } catch (firstErr: any) {
    // 首次失败（常见 ETIMEDOUT：冷启动慢 / claude 初始化检查更新）自动重试一次，
    // 避免"首次打开终端报错、重开又成功"的间歇性问题。
    logger.warn(`[pty] probe 首次失败，自动重试一次 bin=${resolvedBin} code=${firstErr?.code} msg=${firstErr?.message}`);
    try {
      runOnce(8000);
    } catch (err: any) {
      const code = err?.code || 'UNKNOWN';
      const msg = err?.message || String(err);
      // ENOENT: 命令在 PATH 里找不到（resolveBin 已尽量解析，但可能 darwin shell env 解析失败）
      // EACCES: 文件存在但无执行权限（macOS Gatekeeper 隔离、chmod -x）
      // EPERM: macOS sandbox / 系统完整性保护拒绝
      // ETIMEDOUT: 探测 timeout，binary 可能挂在 --version（罕见但需要让用户知道）
      logger.error(`[pty] probe 失败 bin=${resolvedBin} code=${code}: ${msg}`);
      const hint = formatProbeFailureHint(code, resolvedBin, PLATFORM, label, bin);
      throw new Error(`${label} 可执行文件探测失败 (${code}): ${msg}${hint ? `\n${hint}` : ''}`);
    }
  }
}

/** 针对常见错误码给出可执行的 user-facing 提示 */
function formatProbeFailureHint(code: string, resolvedBin: string, platform: string, label: string, bin: string): string {
  if (code === 'ENOENT') {
    return [
      '可能原因：',
      `- ${label} 未安装或不在 PATH 里`,
      `- macOS GUI 启动时 PATH 不完整；在"设置 -> 通用"里为 ${label} 配置绝对路径`,
      platform === 'darwin' ? `  终端执行 \`which ${bin}\` 拿到绝对路径后填入设置` : '',
    ].filter(Boolean).join('\n');
  }
  if (code === 'EACCES') {
    return [
      '可能原因：',
      '- 文件存在但无执行权限',
      platform === 'darwin'
        ? '  macOS 可能因 Gatekeeper 隔离；终端执行 `sudo xattr -dr com.apple.quarantine ' + resolvedBin + '` 解除'
        : '  终端执行 `chmod +x ' + resolvedBin + '` 给执行权限',
    ].join('\n');
  }
  if (code === 'ETIMEDOUT') {
    return `可能原因：${label} --version 响应超过 3s；binary 可能在尝试连网络，请检查上游可达性`;
  }
  return '';
}

/** 输出 ring buffer：保留最近 N 字节，避免长会话内存无限增长 */
class OutputRing {
  private chunks: string[] = [];
  private totalLen = 0;
  private readonly MAX = 4 * 1024; // 4 KB tail
  push(data: string): void {
    this.chunks.push(data);
    this.totalLen += data.length;
    // 超过 MAX 的 1.5 倍时 trim
    while (this.totalLen > this.MAX * 1.5 && this.chunks.length > 1) {
      const oldest = this.chunks.shift()!;
      this.totalLen -= oldest.length;
    }
  }
  /** 取尾部最多 maxBytes 字节（带省略号指示是 tail） */
  tail(maxBytes = 1024): string {
    const all = this.chunks.join('');
    if (all.length <= maxBytes) return all;
    return '...' + all.slice(-maxBytes);
  }
  /** 全量长度（不含省略号），用于判定缓冲是否"短" */
  get length(): number {
    return this.totalLen;
  }
}

function buildCommand(
  bin: string,
  sessionId: string,
  mode: PtyMode,
  env: Record<string, string> = {},
  extraArgs: string[] = [],
): { file: string; args: string[] } {
  const args: string[] = [];
  if (mode === PtyMode.New && sessionId) {
    args.push('--session-id', sessionId);
  } else if (mode === PtyMode.Resume && sessionId) {
    args.push('--resume', sessionId);
  }
  args.push(...extraArgs);

  if (os.platform() === 'win32') {
    const envEntries = Object.entries(env);
    if (envEntries.length === 0) {
      return { file: 'cmd.exe', args: ['/c', bin, ...args] };
    }
    // Windows ConPTY 通过 pty.spawn 的 env 选项传播环境变量不可靠，
    // 在命令行显式 set 后再执行目标程序，确保 ANTHROPIC_BASE_URL 等变量生效。
    const envArgs = envEntries.flatMap(([k, v]) => ['set', `${k}=${v}`]);
    getLogger().info(`[pty] windows env injection: ${envArgs.join(' ')} && ${bin} ${args.join(' ')}`);
    return { file: 'cmd.exe', args: ['/c', ...envArgs, '&&', bin, ...args] };
  }
  return { file: bin, args };
}

export interface StartOptions {
  /**
   * Spawn 前 sync 探测一次（execFileSync --version），把 forkpty 静默失败转成带
   * errno 的明确 throw。**仅当 spawn 的是 claude**（对话用的 binary）才开启。
   * 通用 spawn 应保持 false：探测用 --version 是 claude 专属，cmd.exe / sh 等会失败。
   * macOS forkpty 失败只 onExit=1 拿不到 errno，故此开关专门用来消除 macOS 偶发失败。
   */
  probe?: boolean;
  /** 错误提示用的 agent 展示名（如 'Codex (OpenAI)'）；缺省回退 bin */
  agentLabel?: string;
}

export function start(
  cwd: string,
  sessionId: string,
  bin: string,
  mode: PtyMode,
  env: Record<string, string> = {},
  size: PtySize = { cols: 80, rows: 24 },
  extraArgs: string[] = [],
  opts: StartOptions = {},
): PtyProcess {
  const logger = getLogger();
  const darwinEnv = resolveShellEnv();
  const resolvedBin = resolveBin(bin, darwinEnv);
  const label = opts.agentLabel ?? bin;

  // resolveBin 返回 null 说明 PATH 全程找不到该命令 —— 直接 throw 而不是让
  // node-pty forkpty 静默 exit code=1 拿不到 errno
  if (!resolvedBin) {
    const msg = `未在 PATH 中找到 ${label} 可执行文件: ${bin}\n请在"设置 -> 通用"中为 ${label} 配置可执行文件路径，或检查 ${label} 是否已安装`;
    logger.error(`[pty] ${msg}`);
    throw new Error(msg);
  }

  // 真正的 bin 存在性检查（绝对路径或带 sep 的相对路径才 stat）
  const binExists = statBin(resolvedBin);
  if (binExists === false) {
    const msg = `${label} 可执行文件不存在: ${resolvedBin}`;
    logger.error(`[pty] ${msg}`);
    throw new Error(msg);
  }

  // spawn 前 sync 探测：execFileSync 能拿到 ENOENT/EACCES/EPERM 等 errno，
  // 而 node-pty 在 macOS forkpty 失败时只能在 exit code=1 静默退出（无 errno）。
  // 仅在 spawn 的是 claude（opts.probe=true）时运行，避免对通用 binary（cmd.exe /
  // /bin/sh 等）误判：--version 是 claude 专属，cmd.exe 不认会 exit 1。
  if (opts.probe) {
    probeBin(resolvedBin, { ...process.env, ...darwinEnv, ...env } as { [key: string]: string }, label, bin);
  }

  const { file, args } = buildCommand(resolvedBin, sessionId, mode, env, extraArgs);
  const mergedEnv = { ...process.env, ...darwinEnv, ...env } as { [key: string]: string };

  logger.info(`[pty] spawn ${file} ${args.map((a) => `"${a}"`).join(' ')} (cwd=${cwd}) resolvedBin=${resolvedBin} binExists=${binExists} probe=${!!opts.probe}`);

  const spawnAt = Date.now();
  const ring = new OutputRing();
  let firstData: string | null = null;
  let proc: ReturnType<typeof pty.spawn>;
  try {
    proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env: mergedEnv,
    });
  } catch (err: any) {
    // node-pty 在某些情况下同步抛 EAGAIN / EMFILE 等，包装成带 bin 路径诊断的 error
    const msg = err?.message || String(err);
    logger.error(`[pty] spawn 同步抛出 bin=${resolvedBin} cwd=${cwd} args=${args.join(' ')}: ${msg}`);
    throw new Error(`启动 PTY 失败 (bin=${resolvedBin}, ${msg})`);
  }

  return {
    pid: proc.pid,
    onData: (cb) => {
      proc.onData((data) => {
        if (firstData === null) {
          firstData = data;
          logger.info(`[pty] first data (sid=${sessionId.slice(0, 8)}...): ${data.slice(0, 200)}`);
        }
        ring.push(data);
        cb(data);
      });
    },
    onExit: (cb) => proc.onExit(({ exitCode }) => {
      const durationMs = Date.now() - spawnAt;
      const info: PtyExitInfo = {
        code: exitCode ?? 0,
        durationMs,
        outputTail: ring.tail(2048),
        resolvedBin,
        binExists,
        spawnArgs: args,
        cwd,
      };
      logger.info(`[pty] exited sid=${sessionId.slice(0, 8)}... code=${info.code} duration=${durationMs}ms outputLen=${ring.length} firstData=${firstData ? firstData.slice(0, 120) : 'none'}`);
      cb(info);
    }),
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: (signal) => {
      if (os.platform() === 'win32') {
        // Windows 下进程树为 cmd.exe → claude.exe，必须递归终止整个树
        try {
          execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore', timeout: 3000 });
        } catch { /* 进程可能已退出 */ }
        proc.kill();
      } else {
        proc.kill(signal);
      }
    },
  };
}
