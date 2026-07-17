import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from './app.js';
import { createNotchWindow, closeNotchWindow } from './notch-window.js';
import { getStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let appInstance: App | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function getBuildAssetPath(...segments: string[]): string {
  return path.join(app.getAppPath(), 'build', ...segments);
}

function getWindowIconPath(): string {
  if (process.platform === 'win32') {
    return getBuildAssetPath('windows', 'icon.ico');
  }
  if (process.platform === 'linux') {
    return getBuildAssetPath('linux', 'icon.png');
  }
  return getBuildAssetPath('appicon.png');
}

function getTrayIconPath(): string {
  if (process.platform === 'win32') {
    return getBuildAssetPath('windows', 'trayicon.ico');
  }
  if (process.platform === 'darwin') {
    return getBuildAssetPath('darwin', 'trayicon.png');
  }
  return getBuildAssetPath('linux', 'trayicon.png');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#0A0A0A',
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../../src/renderer/dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.selectionText) {
      template.push({ label: '复制', role: 'copy' });
    }
    if (params.isEditable) {
      template.push({ label: '粘贴', role: 'paste' });
    }
    if (template.length > 0) {
      template.push({ type: 'separator' });
    }
    template.push({ label: '全选', role: 'selectAll' });
    Menu.buildFromTemplate(template).popup({ window: mainWindow! });
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[main] did-fail-load', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  const iconPath = getTrayIconPath();
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Lynel Desktop');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示', click: () => mainWindow?.show() },
      {
        label: '退出',
        click: () => {
          if (tray) {
            tray.destroy();
            tray = null;
          }
          app.quit();
        },
      },
    ]),
  );
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createWindow();
    createTray();

    appInstance = new App();
    appInstance.setWindow(mainWindow!);
    try {
      await appInstance.init();
    } catch (err) {
      console.error('[main] app init failed:', err);
    }

    // 创建灵动岛浮动窗口
    const devUrl = mainWindow?.webContents.getURL() || 'http://localhost:5173/';
    const settingsStore = getStore('settings');
    const notchEnabled = settingsStore.get('notch_enabled', false) as boolean;
    createNotchWindow(isDev, devUrl, path.join(__dirname, 'preload.js'), notchEnabled);
  });

  app.on('before-quit', async () => {
    closeNotchWindow();
    if (appInstance) {
      try {
        await appInstance.shutdown();
      } catch (err) {
        console.error('[main] shutdown failed:', err);
      }
    }
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });
}
