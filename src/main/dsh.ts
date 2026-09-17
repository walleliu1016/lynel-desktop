/**
 * DeepSeek Harness（dsh）进程管理单例。
 *
 * 由 lynel 主进程 spawn `dsh web`（`--port 0` 让 OS 分配随机端口），解析 harness
 * stdout 的 URL 就绪信号（`dsh web: http://127.0.0.1:<port>`，harness 官方注释明确
 * 该行即 readiness signal），把实际 URL 交给渲染进程 iframe 加载。
 *
 * dsh 与 claude 一致：用户通过 `npm install -g @deepseek-ai/dsh` 全局安装，版本由
 * 用户用 npm 管理（升级 `npm i -g dsh@latest`），命令行可直接管理插件
 * （`dsh plugin --profile web add <pkg>`）。Windows 上 dsh 是 `.cmd` shim，
 * 经 `cmd.exe /c` 执行；其他平台直接执行 `dsh`。启动前探测 `dsh --version`，
 * 未安装时给出安装指引。
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import kill from 'tree-kill';
import { getLogger } from './log.js';
import { resolveShellEnvSync } from './pty.js';

/**
 * harness 就绪信号：`dsh web: http://127.0.0.1:<port>[/?token=...]`。
 * 新版 dsh 会带上 `?token=`，必须整条当作 iframe 地址 —— 只取端口自己拼 URL 会丢掉
 * 认证参数，页面加载出来是未鉴权状态。
 */
const URL_LINE_RE = /dsh web: (http:\/\/127\.0\.0\.1:(\d+)\S*)/;

/** harness 启动超时（全局 dsh 首次安装或更新时可能较慢） */
const START_TIMEOUT_MS = 120_000;

/** 查询 npm registry 最新版本超时 */
const NPM_VIEW_TIMEOUT_MS = 30_000;

/** 全局安装 dsh 超时（下载 + 解包，网络慢时可能很久） */
const NPM_INSTALL_TIMEOUT_MS = 300_000;

export interface DshHandle {
  /** 渲染进程 iframe 加载的本地 URL */
  url: string;
  /** 实际监听端口 */
  port: number;
}

export interface DshVersionInfo {
  /** 本地已安装版本（`dsh --version` 输出）；空串表示 dsh 不可执行 */
  current: string;
  /** npm registry 上的最新版本；查询失败为 null（离线/未发布时不给假信息） */
  latest: string | null;
  /** dsh 不可执行时的真实原因（未安装 / 依赖损坏等），供界面如实提示 */
  error?: string;
}

/** npm 在 Windows 上是 `npm.cmd` shim，同样需要 cmd.exe 包装（与 dsh 一致） */
function npmCommand(args: string[]): { cmd: string; args: string[] } {
  return process.platform === 'win32'
    ? { cmd: 'cmd.exe', args: ['/d', '/c', 'npm', ...args] }
    : { cmd: 'npm', args };
}

class DshManager {
  private proc: ChildProcess | null = null;
  /** 更新期间正在跑的 npm 子进程；应用退出时要一并收掉，避免孤儿安装进程 */
  private npmProc: ChildProcess | null = null;
  private handle: DshHandle | null = null;
  private starting: Promise<DshHandle> | null = null;
  private restarting: Promise<DshHandle> | null = null;
  private updating = false;
  private readyHooks: Array<(handle: DshHandle) => Promise<void> | void> = [];

  /** 确保 harness 已启动并返回就绪 URL；已启动则复用单例。 */
  ensure(): Promise<DshHandle> {
    if (this.handle) return Promise.resolve(this.handle);
    if (this.starting) return this.starting;
    this.starting = this.start();
    return this.starting;
  }

  /**
   * 注册就绪回调，在把 URL 交给渲染进程**之前**执行（每次都触发：首次启动、重启、更新后）。
   * 目前用于安装鉴权 cookie —— iframe 早于 cookie 就绪就会撞上 401 页。
   * 回调失败只记日志，不阻塞 harness 启动。
   */
  onReady(hook: (handle: DshHandle) => Promise<void> | void): void {
    this.readyHooks.push(hook);
  }

  private async runReadyHooks(handle: DshHandle): Promise<void> {
    for (const hook of this.readyHooks) {
      try {
        await hook(handle);
      } catch (err) {
        getLogger().warn(`[dsh] ready hook 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** 当前就绪状态（供 UI 展示，不会触发启动）。 */
  get status(): { running: boolean; url?: string } {
    return this.handle ? { running: true, url: this.handle.url } : { running: false };
  }

  /**
   * 重启 harness：杀掉进程树后按原参数重新启动，返回新的就绪 URL。
   *
   * 用途：`~/.dsh` 的 profile（插件）改动后常驻的 dsh 不热加载，必须重启才生效。
   * 每次启动都用 `--port 0`，端口会变，调用方需要把 iframe 切到返回的新 URL。
   */
  async restart(): Promise<DshHandle> {
    if (this.updating) throw new Error('dsh 正在更新中，请稍候再重启');
    if (this.restarting) return this.restarting;
    this.restarting = this.doRestart();
    try {
      return await this.restarting;
    } finally {
      this.restarting = null;
    }
  }

  private async doRestart(): Promise<DshHandle> {
    // 若上一次启动还在进行，先等它落地（失败也无所谓，下面的 shutdown 统一收尾）
    if (this.starting) {
      try { await this.starting; } catch { /* 交由 shutdown 清理残留进程 */ }
    }
    await this.shutdown();
    return this.ensure();
  }

  /**
   * 查询本地与 npm registry 上的 dsh 版本。
   * registry 查询失败（离线 / 代理问题）时 latest 为 null，不阻塞本地版本展示。
   */
  async version(): Promise<DshVersionInfo> {
    const env = this.resolveEnv();
    // 探测失败不是查询失败：把原因带回界面（"没装" 与 "装坏了" 要给不同的下一步）
    let current = '';
    let error: string | undefined;
    try {
      current = this.probeDshVersion(env);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const latest = await this.queryLatestVersion(env);
    return { current, latest, error };
  }

  /**
   * 更新全局 dsh 到最新版（`npm i -g @deepseek-ai/dsh@latest`）。
   *
   * 必须先 shutdown：Windows 下 npm 要覆盖的全局包文件被运行中的 dsh（node.exe）
   * 锁定，带着进程直接安装会以 EBUSY/EPERM 失败。更新完成后由调用方决定是否重启。
   */
  async update(): Promise<{ version: string }> {
    if (this.updating) throw new Error('dsh 正在更新中，请稍候');
    if (this.restarting) throw new Error('dsh 正在重启中，请稍候再更新');
    this.updating = true;
    try {
      await this.shutdown();
      const env = this.resolveEnv();
      await this.runNpmInstall(env);
      const version = this.probeDshVersion(env);
      getLogger().info(`[dsh] updated to ${version}`);
      return { version };
    } finally {
      this.updating = false;
    }
  }

  /** spawn dsh / npm 用的环境：login-shell 的完整 PATH + 本地回环绕过系统代理。 */
  private resolveEnv(): Record<string, string> {
    return {
      ...process.env,
      ...resolveShellEnvSync(),
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: 'localhost,127.0.0.1',
    };
  }

  /** 查询 npm registry 上的最新版本；超时或失败返回 null。 */
  private queryLatestVersion(env: Record<string, string>): Promise<string | null> {
    return new Promise((resolve) => {
      const { cmd, args } = npmCommand(['view', '@deepseek-ai/dsh', 'version']);
      const proc = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = '';
      const timer = setTimeout(() => {
        void this.killTree(proc);
        resolve(null);
      }, NPM_VIEW_TIMEOUT_MS);
      proc.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      proc.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        const text = out.trim();
        resolve(code === 0 && text ? text : null);
      });
    });
  }

  /** 执行全局安装；失败时把 npm 输出的尾部带进错误信息，便于界面提示。 */
  private runNpmInstall(env: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      // --force：npm 默认只检查依赖版本是否满足，不校验已装包的完整性 —— 上一次安装
      // 被打断留下残缺依赖（文件缺失但版本号对得上）时，不加 --force 会直接跳过重新解包，
      // 于是"重新安装"点多少次都修不好。
      const { cmd, args } = npmCommand(['install', '-g', '@deepseek-ai/dsh@latest', '--force']);
      getLogger().info(`[dsh] ${cmd} ${args.join(' ')}`);
      const proc = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      this.npmProc = proc;
      let out = '';
      const timer = setTimeout(() => {
        this.npmProc = null;
        void this.killTree(proc);
        reject(new Error(`npm 安装超时（${NPM_INSTALL_TIMEOUT_MS / 1000}s）`));
      }, NPM_INSTALL_TIMEOUT_MS);
      proc.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      proc.on('error', (err) => {
        clearTimeout(timer);
        this.npmProc = null;
        reject(new Error(`执行 npm 失败: ${err.message}`));
      });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        this.npmProc = null;
        if (code === 0) resolve();
        else reject(new Error(`npm 安装失败（exit ${code ?? ''}）: ${out.trimEnd().slice(-400)}`));
      });
    });
  }

  private async start(): Promise<DshHandle> {
    let cmd: string;
    let args: string[];
    let env: Record<string, string>;
    try {
      // macOS 打包应用从 Finder 启动时 PATH 精简（不含 nvm 目录），直接 spawn 全局
      // dsh 会 ENOENT。resolveEnv 复用 pty.ts 的 login-shell 解析拿到完整 PATH
      // （与 claude 启动一致，非 darwin 返回 {}），否则终端里 which 可见的 dsh
      // 在应用内找不到。
      ({ cmd, args, env } = this.buildCommand());
    } catch (err) {
      // buildCommand 抛错（如 dsh 未安装）时重置单例，避免 rejected starting 被复用
      this.reset();
      throw err;
    }
    // 不传 shell（shell:false）：Windows 下 cmd 为 cmd.exe（真实 .exe），
    // CreateProcess 可直接执行；且 Node 按 CommandLineToArgvW 规则自动给含空格的
    // argv 加引号，避免安装路径含空格被 cmd.exe 拆散。其他平台直接执行 dsh。
    const proc = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.proc = proc;
    getLogger().info(`[dsh] spawning ${cmd} ${args.join(' ')}`);

    return new Promise<DshHandle>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.reset();
        void this.killTree(proc);
        reject(new Error(`dsh web 启动超时（${START_TIMEOUT_MS / 1000}s 未收到就绪信号）`));
      }, START_TIMEOUT_MS);

      const onStdout = (chunk: Buffer) => {
        const text = chunk.toString();
        const trimmed = text.trimEnd();
        if (trimmed) getLogger().debug(`[dsh] ${trimmed}`);
        const m = text.match(URL_LINE_RE);
        if (m && !settled) {
          settled = true;
          clearTimeout(timeout);
          // m[1] 是完整地址（含 token），m[2] 只是端口
          const handle = { url: m[1], port: Number(m[2]) };
          this.handle = handle;
          this.starting = null;
          getLogger().info(`[dsh] ready on ${handle.url}`);
          // 先跑就绪回调（装鉴权 cookie），再把地址交出去
          void this.runReadyHooks(handle).then(() => resolve(handle));
        }
      };
      proc.stdout?.on('data', onStdout);

      let stderrTail = '';
      proc.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        const trimmed = text.trimEnd();
        if (trimmed) getLogger().debug(`[dsh:err] ${trimmed}`);
        stderrTail += text;
        // 插件语法错误之类的堆栈很长，截太狠会把关键行（真实出错位置）裁掉；
        // 16KB 足够放下常见堆栈，真超了保留尾部（错误原因总在最后）
        if (stderrTail.length > 16_000) stderrTail = stderrTail.slice(-12_000);
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.reset();
        reject(new Error(`启动 dsh 失败: ${err.message}`));
      });

      proc.on('exit', (code, signal) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.reset();
          reject(new Error(`dsh web 提前退出 code=${code ?? ''} signal=${signal ?? ''}${stderrTail ? `，stderr: ${stderrTail.trimEnd()}` : ''}`));
        } else {
          // 已就绪后的正常退出（外部 kill 等）：清空单例以便下次重启
          this.reset();
          getLogger().info(`[dsh] exited code=${code ?? ''} signal=${signal ?? ''}`);
        }
      });
    });
  }

  /** 停止 harness 进程（应用退出或用户显式关闭时调用）。 */
  async shutdown(): Promise<void> {
    const proc = this.proc;
    // 更新期间用户直接关掉应用：npm 子进程不能留成孤儿 —— 它会继续写全局包目录，
    // 用户既看不到进度，下次启动还可能撞上半安装状态。
    const npm = this.npmProc;
    this.reset();
    if (proc && proc.pid) {
      getLogger().info('[dsh] shutting down harness');
      // 必须 await 进程树杀净后再返回：tree-kill 内部是异步 taskkill，
      // 若不等完成就 app.exit(0)，taskkill 会被中断导致 cmd.exe/dsh 子进程残留成孤儿。
      await this.killTree(proc);
    }
    if (npm && npm.pid) {
      getLogger().info('[dsh] aborting npm install (app shutdown)');
      await this.killTree(npm);
    }
  }

  /**
   * 杀整个进程树（跨平台）。Windows 上 spawn 带 shell:true 时 proc 是 cmd.exe 包装进程，
   * 只 proc.kill() 会让 npx / node(dsh) 子进程残留成孤儿。
   * tree-kill：Windows 用 taskkill /T，macOS/Linux 用 ps 递归杀子进程后杀根。
   */
  private killTree(proc: ChildProcess): Promise<void> {
    const pid = proc.pid;
    if (!pid) return Promise.resolve();
    getLogger().info(`[dsh] kill process tree pid=${pid}`);
    return new Promise((resolve) => {
      try {
        kill(pid, 'SIGTERM', () => resolve());
      } catch {
        try { proc.kill(); } catch { /* ignore */ }
        resolve();
      }
    });
  }

  private reset(): void {
    this.proc = null;
    this.npmProc = null;
    this.handle = null;
    this.starting = null;
  }

  private buildCommand(): { cmd: string; args: string[]; env: Record<string, string> } {
    const env = this.resolveEnv();
    // --no-open：dsh web 默认打开默认浏览器；harness 在 Lynel 内嵌 iframe 展示，
    // 若不传会额外弹出系统浏览器，重复打开两个位置
    const dshArgs = ['web', '--no-open', '--port', '0'];
    // 与 claude 一致：使用用户全局安装的 dsh（npm install -g @deepseek-ai/dsh），
    // 版本由用户用 npm 管理（升级 npm i -g dsh@latest），命令行可直接管理插件
    // （dsh plugin add）。启动前探测 --version，未安装时给出安装指引。
    this.probeDshVersion(env);
    if (process.platform === 'win32') {
      return { cmd: 'cmd.exe', args: ['/c', 'dsh', ...dshArgs], env };
    }
    return { cmd: 'dsh', args: dshArgs, env };
  }

  /**
   * 解析 dsh 可执行文件的位置；解析不到返回 null（= 没装）。
   *
   * 单独走一次 where/which 的原因：启动始终经 `cmd.exe /c dsh` 包装，而 cmd.exe 本身
   * 一定存在，所以 execFileSync 的 ENOENT 永远不会触发 —— 只看退出码分不清「没装」
   * 和「装了但跑不起来」（例如依赖被装坏，node 直接 ERR_MODULE_NOT_FOUND 崩掉）。
   */
  private resolveDshPath(env: Record<string, string>): string | null {
    try {
      const out = process.platform === 'win32'
        ? execFileSync('where', ['dsh'], { env, stdio: 'pipe' })
        : execFileSync('which', ['dsh'], { env, stdio: 'pipe' });
      const first = out.toString().split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      return first ?? null;
    } catch {
      return null;
    }
  }

  /** 探测 dsh 版本；未安装或执行失败都抛错，但错误信息区分这两种情况。 */
  private probeDshVersion(env: Record<string, string>): string {
    const dshPath = this.resolveDshPath(env);
    if (!dshPath) {
      throw new Error('未找到 dsh 命令，请先执行: npm install -g @deepseek-ai/dsh');
    }
    try {
      const out = process.platform === 'win32'
        ? execFileSync('cmd.exe', ['/d', '/c', 'dsh', '--version'], { env, stdio: 'pipe' })
        : execFileSync('dsh', ['--version'], { env, stdio: 'pipe' });
      // `dsh --version` 输出可能带换行 / ANSI 前缀（如 `dsh/0.1.0-rc.7`），取最后一段
      const text = out.toString().trim();
      return text.split(/\s+/).pop() ?? text;
    } catch (err) {
      // 命令在，但执行不起来：把真实原因（stderr 尾部）带出来，不要再误报成"没装"
      const e = err as { status?: number; stderr?: Buffer | string };
      const stderr = (e.stderr ?? '').toString().trim();
      const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 300);
      throw new Error(`dsh 已安装（${dshPath}）但无法执行${tail ? `：${tail}` : `（exit ${e.status ?? '?'}）`}`);
    }
  }
}

export const dshManager = new DshManager();
