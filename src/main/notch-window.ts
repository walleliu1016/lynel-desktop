import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLogger } from './log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const logger = getLogger().scope('notch-window');

// 初始尺寸（闭口态药丸）
const PILL_W = 240;
const PILL_H = 34;
// 窗口最大尺寸
const MAX_W = 400;
const MAX_H = 500;

let notchWin: BrowserWindow | null = null;

export function getNotchWindow(): BrowserWindow | null {
  return notchWin;
}

export function createNotchWindow(isDev: boolean, devUrl: string, preloadPath: string): BrowserWindow {
  if (notchWin && !notchWin.isDestroyed()) {
    notchWin.show();
    return notchWin;
  }

  notchWin = new BrowserWindow({
    width: PILL_W,
    height: PILL_H,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  notchWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notchWin.setAlwaysOnTop(true, 'screen-saver');

  // 窗口本身只有药丸大小，不需要鼠标穿透
  notchWin.setIgnoreMouseEvents(false);

  positionAtTopCenter(notchWin, PILL_W);

  if (isDev) {
    notchWin.loadURL(`${devUrl}#/notch`);
  } else {
    const indexPath = path.join(__dirname, '../../../src/renderer/dist/index.html');
    logger.info('[notch-window] loading file=%s preload=%s', indexPath, preloadPath);
    notchWin.loadFile(indexPath, { hash: '/notch' });
  }

  notchWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    logger.error('[notch-window] did-fail-load %s %s', errorCode, errorDescription);
  });

  notchWin.once('ready-to-show', () => {
    notchWin?.show();
    logger.info('[notch-window] ready-to-show, shown');
  });

  setTimeout(() => {
    if (notchWin && !notchWin.isDestroyed() && !notchWin.isVisible()) {
      notchWin.show();
      logger.info('[notch-window] fallback show after timeout');
    }
  }, 5000);

  notchWin.on('closed', () => {
    notchWin = null;
    logger.info('[notch-window] closed');
  });

  return notchWin;
}

function positionAtTopCenter(win: BrowserWindow, w: number): void {
  const primary = screen.getPrimaryDisplay();
  const { x, width } = primary.workArea;
  const centerX = Math.round(x + (width - w) / 2);
  win.setPosition(centerX, 0);
}

export function resizeNotchWindow(w: number, h: number): void {
  if (!notchWin || notchWin.isDestroyed()) return;
  const clampedW = Math.min(w, MAX_W);
  const clampedH = Math.min(h, MAX_H);
  notchWin.setSize(clampedW, clampedH);
  positionAtTopCenter(notchWin, clampedW);
  // 强制 Windows 重新计算鼠标命中区域，避免缩小后旧区域仍拦截点击
  notchWin.setIgnoreMouseEvents(true, { forward: true });
  notchWin.setIgnoreMouseEvents(false);
  logger.info('[notch-window] resize %dx%d', clampedW, clampedH);
}

export function setNotchMousePassthrough(passthrough: boolean): void {
  if (notchWin && !notchWin.isDestroyed()) {
    notchWin.setIgnoreMouseEvents(passthrough, { forward: true });
  }
}

export function closeNotchWindow(): void {
  if (notchWin && !notchWin.isDestroyed()) {
    notchWin.close();
    notchWin = null;
  }
}

export function showNotchWindow(): void {
  if (notchWin && !notchWin.isDestroyed() && !notchWin.isVisible()) {
    notchWin.show();
  }
}

export function hideNotchWindow(): void {
  if (notchWin && !notchWin.isDestroyed()) {
    notchWin.hide();
  }
}
