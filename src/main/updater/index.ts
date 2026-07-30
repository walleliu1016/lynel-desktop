import { ipcMain, BrowserWindow, app } from 'electron';
import { getStore } from '../store.js';
import { getLogger } from '../log.js';
import { checkForUpdates } from './checker.js';
import { downloadUpdate, quitAndInstall } from './downloader.js';
import type { UpdateConfig, UpdateState } from './types.js';

const logger = getLogger('updater');

const DEFAULT_CONFIG: UpdateConfig = {
  githubEnabled: true,
  httpEnabled: false,
  httpBaseUrl: '',
  channel: 'stable',
};

function config(): UpdateConfig {
  const store = getStore('updater');
  return { ...DEFAULT_CONFIG, ...(store.get('config') as Partial<UpdateConfig> | undefined) };
}

export function getConfig(): UpdateConfig {
  return config();
}

function saveConfig(cfg: UpdateConfig): void {
  const store = getStore('updater');
  store.set('config', cfg);
}

export function initUpdater(getMainWindow: () => BrowserWindow): void {
  const send = (state: UpdateState) => {
    try {
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
    status: 'idle' as const,
    lastCheckTime: 0,
    currentVersion: app.getVersion(),
  }));

  ipcMain.handle('app:getUpdateConfig', async () => config());

  ipcMain.handle('app:updateUpdateConfig', async (_event, cfg: Partial<UpdateConfig>) => {
    const current = config();
    const updated = { ...current, ...cfg };
    saveConfig(updated);
    logger.info('[updater] config updated');
    return updated;
  });

  async function scheduledCheck() {
    try {
      logger.info('[updater] 定时检查更新');
      const result = await checkForUpdates(config(), app.getVersion());
      if (result.hasUpdate && result.forceUpdate) {
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
