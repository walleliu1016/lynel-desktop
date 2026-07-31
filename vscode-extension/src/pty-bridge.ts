import * as os from 'node:os';
import { execFile } from 'node:child_process';

// macOS env 缓存
let cachedDarwinEnv: Record<string, string> | null = null;

export async function preloadEnv(): Promise<void> {
  if (os.platform() !== 'darwin') return;
  const userShell = process.env.SHELL || '/bin/zsh';
  return new Promise<void>((resolve) => {
    execFile(
      userShell, ['-ilc', 'env'],
      { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 },
      (err: Error | null, stdout: string) => {
        if (!err && stdout) {
          cachedDarwinEnv = {};
          for (const line of stdout.split('\n')) {
            const idx = line.indexOf('=');
            if (idx > 0) {
              cachedDarwinEnv[line.slice(0, idx)] = line.slice(idx + 1);
            }
          }
        }
        resolve();
      },
    );
  });
}
