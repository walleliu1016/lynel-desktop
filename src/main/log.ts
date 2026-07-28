// 主进程日志：基于 electron-log，但懒加载 + 缺失时降级到 console。
//
// 设计原因：
// - electron-log 的入口模块在 require('electron') 顶层执行 getElectronPath()，
//   在 CI / 测试环境如果 electron binary 不可用（postinstall 下载失败、sandbox
//   拦网、缓存清理等），整个 import 链会抛 "Electron failed to install correctly"，
//   导致所有用到 logger 的测试都加载失败。
// - 改为首次调用 getLogger() 时再加载，加载失败则降级到 console（仅 stdout 输出），
//   保证日志调用方代码在两种环境下都能跑。

type ElectronLog = {
  scope: (name: string) => ElectronLog;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  verbose: (...args: unknown[]) => void;
  silly: (...args: unknown[]) => void;
  initialize?: () => void;
};

let _log: ElectronLog | null = null;
let _loaded = false;

function createConsoleFallback(): ElectronLog {
  const make = (level: 'info' | 'warn' | 'error' | 'debug'): ElectronLog['info'] =>
    (...args: unknown[]) => {
      const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '';
      const line = prefix ? `${prefix} ${args.map(stringifyArg).join(' ')}` : args.map(stringifyArg).join(' ');
      const stream = level === 'error' ? process.stderr : process.stdout;
      try { stream.write(line + '\n'); } catch { /* ignore EPIPE */ }
    };
  const base: ElectronLog = {
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
    verbose: make('info'),
    silly: make('debug'),
    scope(name: string) {
      // console fallback 也支持 scope，但只是前缀装饰
      const tagged = (level: 'info' | 'warn' | 'error' | 'debug') =>
        (...args: unknown[]) => base[level](`[${name}]`, ...args);
      return {
        ...base,
        info: tagged('info'),
        warn: tagged('warn'),
        error: tagged('error'),
        debug: tagged('debug'),
        verbose: tagged('info'),
        silly: tagged('debug'),
        scope: base.scope,
      };
    },
  };
  return base;
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
    try { _log.initialize?.(); } catch { /* 旧版 API 无 initialize，忽略 */ }
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
