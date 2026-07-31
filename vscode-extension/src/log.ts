// VS Code 适配的 log 模块，使用 OutputChannel 让日志在输出面板可见
import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | null = null;

function getChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Lynel');
  }
  return outputChannel;
}

function createLogger(scope: string) {
  const s = scope.startsWith('lynel/') ? scope : `lynel/${scope}`;
  return {
    info: (...args: unknown[]) => {
      const msg = `[${s}] ${args.map(String).join(' ')}`;
      console.log(msg);
      getChannel().appendLine(msg);
    },
    warn: (...args: unknown[]) => {
      const msg = `[${s}] WARN ${args.map(String).join(' ')}`;
      console.warn(msg);
      getChannel().appendLine(msg);
    },
    error: (...args: unknown[]) => {
      const msg = `[${s}] ERROR ${args.map(String).join(' ')}`;
      console.error(msg);
      getChannel().appendLine(msg);
    },
    debug: (...args: unknown[]) => {
      const msg = `[${s}] DEBUG ${args.map(String).join(' ')}`;
      console.debug(msg);
      getChannel().appendLine(msg);
    },
    scope: (sub: string) => createLogger(`${s}/${sub}`),
  };
}

const rootLogger = createLogger('lynel');

export function getLogger() {
  return rootLogger;
}

export function disposeLogger(): void {
  outputChannel?.dispose();
  outputChannel = null;
}
