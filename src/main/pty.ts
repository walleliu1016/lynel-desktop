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
// 找不到时返回原始 bin，上层仍会被 spawn，由 node-pty 的 onExit(code=1) 兜底。
function resolveBin(bin: string, env: Record<string, string>): string {
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
  return bin;
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

export function start(
  cwd: string,
  sessionId: string,
  bin: string,
  mode: PtyMode,
  env: Record<string, string> = {},
  size: PtySize = { cols: 80, rows: 24 },
  extraArgs: string[] = [],
): PtyProcess {
  const darwinEnv = resolveShellEnv();
  const resolvedBin = resolveBin(bin, darwinEnv);
  const binExists = statBin(resolvedBin);
  const { file, args } = buildCommand(resolvedBin, sessionId, mode, env, extraArgs);
  const mergedEnv = { ...process.env, ...darwinEnv, ...env } as { [key: string]: string };

  const logger = getLogger();
  logger.info(`[pty] spawn ${file} ${args.map((a) => `"${a}"`).join(' ')} (cwd=${cwd}) resolvedBin=${resolvedBin} binExists=${binExists}`);

  // spawn 前 warn：bin 路径绝对路径但文件不存在，node-pty 会立即 exit code=1
  if (binExists === false) {
    logger.error(`[pty] bin not found: ${resolvedBin} (configured=${bin})，spawn 将失败`);
  }

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
