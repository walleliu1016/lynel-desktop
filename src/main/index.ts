import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from './app.js';
import { getStore } from './store.js';
import { windowAttention, type AttentionPendingEntry } from './attention.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let appInstance: App | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Windows 通知需要稳定的 AppUserModelId，否则可能不显示或归到 generic host 下
// 同步把 app name 设成产品名（dev 模式默认是 "Electron"），通知中显示才正确
app.setName('Lynel Desktop');
app.setAppUserModelId('com.lynel.desktop');

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
    // macOS 用 hiddenInset 保留红绿灯，不能设 frame:false（会禁用窗口控制按钮）
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 15 } as const }
      : { frame: false as const, titleBarStyle: 'hidden' as const }),
    show: false,
    backgroundColor: '#0A0A0A',
    icon: process.platform === 'darwin' ? undefined : getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5180');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../../src/renderer/dist/index.html'));
  }

  // F12 切换 DevTools（开发/生产均可用）
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools();
    }
  });

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

function rebuildTrayMenu(_pendingEntries: AttentionPendingEntry[]): void {
  if (!tray) return;
  tray.setToolTip('Lynel Desktop');

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => windowAttention.focusMainWindow() },
      { type: 'separator' },
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

function createTray(): void {
  const iconPath = getTrayIconPath();
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  // 初次构建空菜单 + tooltip
  rebuildTrayMenu([]);

  // 点击 / 双击托盘图标：有待审批则跳到对应会话，否则聚焦主窗口。
  // Windows 上 setContextMenu 只接管右键菜单，左键 click 事件仍需显式注册，
  // 否则点击托盘无任何反应（既不跳转也不前置）。
  const onTrayActivate = (): void => {
    if (windowAttention.getPendingCount() > 0) {
      windowAttention.focusOldestPending();
    } else {
      windowAttention.focusMainWindow();
    }
  };
  tray.on('click', onTrayActivate);
  tray.on('double-click', onTrayActivate);

  // 接入 attention 回调：pending 变化时重建
  windowAttention.setOnPendingChange((_count, entries) => {
    rebuildTrayMenu(entries);
  });
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

    // macOS: 设置 dock 图标并确保显示
    if (process.platform === 'darwin') {
      const dockIconPath = getBuildAssetPath('appicon.png');
      try {
        const dockIcon = nativeImage.createFromPath(dockIconPath);
        if (!dockIcon.isEmpty()) {
          app.dock?.setIcon(dockIcon);
        }
      } catch (err) {
        console.error('[main] failed to set dock icon:', err);
      }
      app.dock?.show();
    }

    appInstance = new App();
    appInstance.setWindow(mainWindow!);
    try {
      await appInstance.init();
    } catch (err) {
      console.error('[main] app init failed:', err);
    }
  });

  // before-quit 是同步事件，Electron 不会 await async 回调。
  // 必须用 event.preventDefault() 阻止立即退出，异步完成 shutdown 后再 app.exit(0)。
  // 否则 PTY 子进程会被 OS 强杀成孤儿、apiproxy/hookserver 的 listening socket 被 RST，
  // 下次启动 claude CLI POST hook 会收到 ECONNRESET。
  let shuttingDown = false;
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    void (async () => {
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
      app.exit(0);
    })();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
