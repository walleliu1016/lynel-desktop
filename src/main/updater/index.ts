import { ipcMain, BrowserWindow, app } from 'electron';
import { getStore } from '../store.js';
import { getLogger } from '../log.js';
import { checkForUpdates } from './checker.js';
import { downloadUpdate, quitAndInstall } from './downloader.js';
import type { UpdateConfig, UpdateState } from './types.js';

const logger = getLogger();

let lastUpdateState: UpdateState = { status: 'idle' };
let startupCheckDone = false;

// 读取云服务配置作为 HTTP fallback 地址
function cloudFallbackConfig(): { httpEnabled: boolean; httpBaseUrl: string } {
  try {
    const store = getStore('default');
    const enabled = store.get('cloud_service_enabled') as boolean | undefined;
    const url = store.get('cloud_service_url') as string | undefined;
    return {
      httpEnabled: !!enabled && !!url,
      httpBaseUrl: url ?? '',
    };
  } catch {
    return { httpEnabled: false, httpBaseUrl: '' };
  }
}

function config(): UpdateConfig {
  const fallback = cloudFallbackConfig();
  return {
    githubEnabled: true,
    channel: 'stable',
    ...fallback,
  };
}

export function initUpdater(getMainWindow: () => BrowserWindow): void {
  const send = (state: UpdateState) => {
    try {
      lastUpdateState = state;
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('update:state', state);
      }
    } catch {}
  };

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      send({ status: 'checking' });
      const result = await checkForUpdates(config(), app.getVersion());
      if (!result.hasUpdate) {
        send({ status: 'no-update' });
        return { hasUpdate: false };
      }
      send({ status: 'available', data: { version: result.version } });
      return {
        hasUpdate: true,
        version: result.version,
        releaseDate: result.releaseDate,
        releaseNotes: result.releaseNotes,
        forceUpdate: result.forceUpdate,
        downloadUrl: result.downloadUrl,
        sha512: result.sha512,
        size: result.size,
      };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logger.error(`[updater] checkUpdate failed: ${msg}`);
      send({ status: 'error', data: { error: msg } });
      return { hasUpdate: false, error: msg };
    }
  });

  ipcMain.handle('app:downloadUpdate', async (_event, info: any) => {
    try {
      await downloadUpdate(
        {
          hasUpdate: true,
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes,
          forceUpdate: info.forceUpdate,
          downloadUrl: info.downloadUrl,
          sha512: info.sha512,
          size: info.size,
        },
        send,
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      send({ status: 'error', data: { error: msg } });
      throw err;
    }
  });

  ipcMain.handle('app:quitAndInstall', async () => {
    quitAndInstall();
  });

  ipcMain.handle('app:getUpdateStatus', async () => ({
    ...lastUpdateState,
    currentVersion: app.getVersion(),
  }));

  async function scheduledCheck() {
    try {
      logger.info('[updater] 定时检查更新');
      const result = await checkForUpdates(config(), app.getVersion());
      if (!result.hasUpdate) {
        startupCheckDone = true;
        return;
      }
      if (!startupCheckDone) {
        send({ status: 'available', data: { version: result.version, source: 'startup' } });
        startupCheckDone = true;
        return;
      }
      if (result.forceUpdate) {
        send({ status: 'available', data: { version: result.version } });
      }
    } catch {}
  }

  // 首次启动 5 秒后检查
  setTimeout(scheduledCheck, 5_000);
  // 每 4 小时检查
  setInterval(scheduledCheck, 4 * 60 * 60 * 1000);

  logger.info('[updater] initialized');
}
