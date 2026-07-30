import { autoUpdater } from 'electron-updater';
import { getLogger } from '../log.js';
import type { CheckResult, UpdateState } from './types.js';

const logger = getLogger('updater:downloader');

export function downloadUpdate(
  info: CheckResult,
  onProgress: (state: UpdateState) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // 不依赖 autoUpdater 内置 provider，手动传入更新信息触发下载
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: new URL(info.downloadUrl!).origin,
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
      if (!resolved) {
        resolved = true;
        onProgress({ status: 'downloaded', data: { version: info.version } });
        resolve();
      }
    });

    autoUpdater.on('error', (err) => {
      logger.error(`[downloader] 下载失败: ${err.message}`);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    // 直接传入 UpdateInfo 触发下载
    autoUpdater.downloadUpdate({
      version: info.version!,
      files: [{ url: info.downloadUrl!, sha512: info.sha512, size: info.size }],
      path: info.downloadUrl!,
      releaseDate: info.releaseDate!,
      releaseNotes: info.releaseNotes,
    }).catch((err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
