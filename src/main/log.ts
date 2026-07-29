// 主进程日志：基于 electron-log，懒加载 + 缺失时降级到 console。
//
// 设计原因：
// - electron-log 的入口模块在 require('electron') 顶层执行 getElectronPath()，
//   在 CI / 测试环境如果 electron binary 不可用（postinstall 下载失败、sandbox
//   拦网、缓存清理等），整个 import 链会抛 "Electron failed to install
//   correctly"，导致所有用到 logger 的测试都加载失败。
// - 改为首次调用 getLogger() 时再加载，加载失败则降级到 console。
// - 保留 electron-log 的真实类型签名：用 import type 引入 MainLogger，
//   fallback 用 as 强转（不完整字段的访问在 fallback 路径下运行时不会触发，
//   因为上层 app.ts 里 transports.file.level 仅在 settings 更新时调用，
//   测试不会走到）。

import type LogType from 'electron-log/main';

type ElectronLog = typeof LogType;

let _log: ElectronLog | null = null;
let _loaded = false;

function createConsoleFallback(): ElectronLog {
  // 底层 single-shot 写流函数；scope 只是前缀标签，不递归
  const make = (level: 'info' | 'warn' | 'error' | 'debug' | 'verbose' | 'silly') =>
    (...args: unknown[]) => {
      const tag = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '';
      const line = (tag ? `${tag} ` : '') + args.map(stringifyArg).join(' ');
      const stream = level === 'error' ? process.stderr : process.stdout;
      try { stream.write(line + '\n'); } catch { /* ignore EPIPE */ }
    };
  // 先声明 root，scopeImpl 闭包到 root（const TDZ 在 make 函数被调用时已过）
  const root: any = {
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
    verbose: make('verbose'),
    silly: make('silly'),
    // app.ts 可能访问 transports.file.level = ...；fallback 下用 no-op 占位
    transports: {
      file: { level: 'info' as const },
      console: { level: 'info' as const },
      remote: { level: false as const },
    },
    initialize() {},
  };
  // scope 返回的 logger 复用 root.<level> 的底层写流函数，加 [name] 前缀
  // 关键：调用 root[level] 而非 base[level]，否则 base[level] === tagged(level)
  // 自调用形成无限递归（nest 时深度爆栈）
  const scopeImpl = (name: string): ElectronLog => {
    const tagged = (level: 'info' | 'warn' | 'error' | 'debug' | 'verbose' | 'silly') =>
      (...args: unknown[]) => root[level](`[${name}]`, ...args);
    const scoped: any = {
      info: tagged('info'),
      warn: tagged('warn'),
      error: tagged('error'),
      debug: tagged('debug'),
      verbose: tagged('verbose'),
      silly: tagged('silly'),
      scope: scopeImpl,
      transports: root.transports,
      initialize() {},
    };
    return scoped as ElectronLog;
  };
  root.scope = scopeImpl;
  return root as ElectronLog;
}

function stringifyArg(a: unknown): string {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function loadLogger(): ElectronLog {
  if (_loaded) return _log!;
  _loaded = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('electron-log/main');
    _log = (mod.default ?? mod) as ElectronLog;
    try { (_log as any).initialize?.(); } catch { /* 旧版 API 无 initialize，忽略 */ }
    // 防止 stdout/stderr 管道断开导致 EPIPE 崩溃
    // 当父进程（npm/concurrently）关闭时，管道写入会抛出 EPIPE
    const ignoreEpipe = (stream: NodeJS.WriteStream) => {
      stream.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') return;
      });
    };
    ignoreEpipe(process.stdout);
    ignoreEpipe(process.stderr);
  } catch {
    // electron binary 不可用 / electron-log 加载失败 → 降级到 console
    _log = createConsoleFallback();
  }
  return _log;
}

export function getLogger(): ElectronLog {
  return loadLogger();
}