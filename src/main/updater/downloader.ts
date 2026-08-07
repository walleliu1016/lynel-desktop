import { createRequire } from 'node:module';
import { getLogger } from '../log.js';
import type { CheckResult, UpdateState } from './types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const esmRequire = createRequire(import.meta.url);

// electron-updater 的 autoUpdater getter 首次访问时会 new NsisUpdater/MacUpdater，
// 构造时调用 app.getVersion()。在无 Electron runtime 的测试环境会抛错。
// 用懒加载只在真正下载/安装时才访问，避免模块加载阶段触发副作用。
// 这里按 electron-updater 真实返回类型声明一个最小子集，避免 result 被推断成 unknown。
interface UpdateCheckResult {
  isUpdateAvailable: boolean;
  updateInfo?: { version: string };
  version?: string;
}

interface AutoUpdater {
  setFeedURL(opts: { provider: string; url: string }): void;
  on(event: 'download-progress', cb: (progress: { percent: number; bytesPerSecond: number }) => void): void;
  on(event: 'update-downloaded', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  checkForUpdates(): Promise<UpdateCheckResult | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

function getAutoUpdater(): AutoUpdater {
  const mod = esmRequire('electron-updater') as { autoUpdater: AutoUpdater };
  return mod.autoUpdater;
}

const logger = getLogger();

function writeTempLatestYml(info: CheckResult): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-update-'));
  const yml = [
    `version: ${info.version}`,
    `releaseDate: ${info.releaseDate}`,
    `path: ${info.downloadUrl}`,
    info.sha512 ? `sha512: ${info.sha512}` : '',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(path.join(dir, 'latest.yml'), yml, 'utf8');
  logger.info(`[downloader] 临时 latest.yml 写入: ${dir}`);
  return dir;
}

export function downloadUpdate(
  info: CheckResult,
  onProgress: (state: UpdateState) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const autoUpdater = getAutoUpdater();
    const tempDir = writeTempLatestYml(info);

    autoUpdater.setFeedURL({
      provider: 'generic',
      url: `file://${tempDir}`,
    });

    let resolved = false;

    autoUpdater.on('download-progress', (progress) => {
      onProgress({
        status: 'downloading',
        data: {
          version: info.version,
          percent: progress.percent,
          speed: progress.bytesPerSecond,
        },
      });
    });

    autoUpdater.on('update-downloaded', () => {
      logger.info(`[downloader] 下载完成: ${info.version}`);
      // 清理临时文件
      try { fs.rmSync(tempDir, { recursive: true }); } catch {}
      if (!resolved) {
        resolved = true;
        onProgress({ status: 'downloaded', data: { version: info.version } });
        resolve();
      }
    });

    autoUpdater.on('error', (err) => {
      logger.error(`[downloader] 下载失败: ${err.message}`);
      try { fs.rmSync(tempDir, { recursive: true }); } catch {}
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    // checkForUpdates 读取临时 latest.yml 发现更新，再 downloadUpdate 执行下载
    autoUpdater.checkForUpdates().then((result) => {
      // 未打包（dev 模式）或版本未严格提升时 updateInfoAndProvider 不会设置，
      // 直接 downloadUpdate 会抛 "Please check update first"，这里给出明确错误
      if (!result?.isUpdateAvailable) {
        throw new Error('当前已是最新版本，无需下载');
      }
      return autoUpdater.downloadUpdate();
    }).catch((err) => {
      try { fs.rmSync(tempDir, { recursive: true }); } catch {}
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
}

export function quitAndInstall(): void {
  getAutoUpdater().quitAndInstall();
}
