/**
 * DeepSeek Harness（dsh）进程管理单例。
 *
 * 路线 A（WebView 内嵌）：由 lynel 主进程 spawn `dsh web`（`--port 0` 让 OS
 * 分配随机端口），解析 harness stdout 的 URL 就绪信号（`dsh web: http://127.0.0.1:<port>`，
 * harness 官方注释明确该行即 readiness signal），把实际 URL 交给渲染进程 iframe 加载。
 *
 * dev 用 `npx @deepseek-ai/dsh`（npx 缓存已就绪）；生产用应用内置的 dsh bin
 * （`ELECTRON_RUN_AS_NODE=1` + 应用自带 node，避免依赖系统 node）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import kill from 'tree-kill';
import { app } from 'electron';
import { getLogger } from './log.js';

/** harness 就绪信号：`dsh web: http://127.0.0.1:<port>` */
const URL_LINE_RE = /dsh web: http:\/\/127\.0\.0\.1:(\d+)/;

/** harness 启动超时（npx 首次拉包可能较慢） */
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
    const { cmd, args, env } = this.buildCommand();
    // Windows 上 Electron 主进程直接 spawn `.cmd` 会抛 EINVAL（CreateProcess 无法执行 .cmd），
    // 必须走 shell（cmd.exe /c）解析；非 Windows 无此问题。
    const proc = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
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
      // 若不等完成就 app.exit(0)，taskkill 会被中断导致 npx/dsh 子进程残留成孤儿。
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

  private buildCommand(): { cmd: string; args: string[]; env: Record<string, string> } {
    // 本地回环流量绕过系统代理，避免 iframe 加载 localhost 被代理拦截
    const env = { NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1' };
    const dshArgs = ['web', '--port', '0'];
    if (app.isPackaged) {
      // 生产：应用内置的 dsh（@deepseek-ai/dsh 随 dependencies 打包，node_modules 经
      // asarUnpack 解出到 app.asar.unpacked），用 Electron 自带 node 执行（RUN_AS_NODE）。
      const dshBin = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '@deepseek-ai',
        'dsh',
        'lib',
        'bin.js',
      );
      return {
        cmd: process.execPath,
        args: [dshBin, ...dshArgs],
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      };
    }
    // dev：npx（已缓存 @deepseek-ai/dsh）；Windows 经 shell 解析 npx.cmd
    const cmd = 'npx';
    return { cmd, args: ['--yes', '@deepseek-ai/dsh', ...dshArgs], env };
  }
}

export const dshManager = new DshManager();
