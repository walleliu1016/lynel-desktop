import { autoUpdater } from 'electron-updater';
import { getLogger } from '../log.js';
import type { CheckResult, UpdateState } from './types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
    autoUpdater.checkForUpdates().then(() => {
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
  autoUpdater.quitAndInstall();
}
