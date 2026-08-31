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

/** harness 就绪信号：`dsh web: http://127.0.0.1:<port>` */
const URL_LINE_RE = /dsh web: http:\/\/127\.0\.0\.1:(\d+)/;

/** harness 启动超时（全局 dsh 首次安装或更新时可能较慢） */
const START_TIMEOUT_MS = 120_000;

export interface DshHandle {
  /** 渲染进程 iframe 加载的本地 URL */
  url: string;
  /** 实际监听端口 */
  port: number;
}

class DshManager {
  private proc: ChildProcess | null = null;
  private handle: DshHandle | null = null;
  private starting: Promise<DshHandle> | null = null;

  /** 确保 harness 已启动并返回就绪 URL；已启动则复用单例。 */
  ensure(): Promise<DshHandle> {
    if (this.handle) return Promise.resolve(this.handle);
    if (this.starting) return this.starting;
    this.starting = this.start();
    return this.starting;
  }

  /** 当前就绪状态（供 UI 展示，不会触发启动）。 */
  get status(): { running: boolean; url?: string } {
    return this.handle ? { running: true, url: this.handle.url } : { running: false };
  }

  private async start(): Promise<DshHandle> {
    let cmd: string;
    let args: string[];
    let env: Record<string, string>;
    try {
      // macOS 打包应用从 Finder 启动时 PATH 精简（不含 nvm 目录），直接 spawn 全局
      // dsh 会 ENOENT。复用 pty.ts 的 login-shell 解析拿到完整 PATH（与 claude 启动
      // 一致，非 darwin 返回 {}），否则终端里 which 可见的 dsh 在应用内找不到。
      const shellEnv = resolveShellEnvSync();
      ({ cmd, args, env } = this.buildCommand(shellEnv));
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
          const port = Number(m[1]);
          this.handle = { url: `http://127.0.0.1:${port}`, port };
          this.starting = null;
          getLogger().info(`[dsh] ready on ${this.handle.url}`);
          resolve(this.handle);
        }
      };
      proc.stdout?.on('data', onStdout);

      let stderrTail = '';
      proc.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        const trimmed = text.trimEnd();
        if (trimmed) getLogger().debug(`[dsh:err] ${trimmed}`);
        stderrTail += text;
        if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-2000);
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
    this.reset();
    if (proc && proc.pid) {
      getLogger().info('[dsh] shutting down harness');
      // 必须 await 进程树杀净后再返回：tree-kill 内部是异步 taskkill，
      // 若不等完成就 app.exit(0)，taskkill 会被中断导致 cmd.exe/dsh 子进程残留成孤儿。
      await this.killTree(proc);
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
    this.handle = null;
    this.starting = null;
  }

  private buildCommand(shellEnv: Record<string, string>): { cmd: string; args: string[]; env: Record<string, string> } {
    // 先铺 login-shell 解析出的完整环境（darwin 下补全 nvm 等 PATH），
    // 再叠加本地回环流量绕过系统代理，避免 iframe 加载 localhost 被代理拦截
    const env: Record<string, string> = {
      ...shellEnv,
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: 'localhost,127.0.0.1',
    };
    // --no-open：dsh web 默认打开默认浏览器；harness 在 Lynel 内嵌 iframe 展示，
    // 若不传会额外弹出系统浏览器，重复打开两个位置
    const dshArgs = ['web', '--no-open', '--port', '0'];
    // 与 claude 一致：使用用户全局安装的 dsh（npm install -g @deepseek-ai/dsh），
    // 版本由用户用 npm 管理（升级 npm i -g dsh@latest），命令行可直接管理插件
    // （dsh plugin add）。启动前探测 --version，未安装时给出安装指引。
    this.ensureDshInstalled(env);
    if (process.platform === 'win32') {
      return { cmd: 'cmd.exe', args: ['/c', 'dsh', ...dshArgs], env };
    }
    return { cmd: 'dsh', args: dshArgs, env };
  }

  /** 探测 dsh 是否已全局安装；未安装抛出带安装指引的错误。 */
  private ensureDshInstalled(env: Record<string, string>): void {
    const spawnEnv = { ...process.env, ...env };
    try {
      if (process.platform === 'win32') {
        execFileSync('cmd.exe', ['/d', '/c', 'dsh', '--version'], { env: spawnEnv, stdio: 'pipe' });
      } else {
        execFileSync('dsh', ['--version'], { env: spawnEnv, stdio: 'pipe' });
      }
    } catch {
      throw new Error('未找到 dsh 命令，请先执行: npm install -g @deepseek-ai/dsh');
    }
  }
}

export const dshManager = new DshManager();
