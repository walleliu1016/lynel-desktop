// 窗口注意力中心：权限待审批时把"主窗口不在前台"这件事变得可见。
// 信号按平台分支：
//   Windows: BrowserWindow.flashFrame 任务栏闪烁 + 系统通知
//   macOS:   app.dock.bounce + app.setBadgeCount + 系统通知
//   Linux:   app.setBadgeCount + 系统通知
// 通知点击后会激活主窗口并切到对应 session tab。

import { app, BrowserWindow, Notification, type Notification as NotificationType } from 'electron';
import path from 'node:path';
import { getLogger } from './log.js';
import { getBus } from './events.js';

const logger = getLogger().scope('attention');

const NOTIFY_DEBOUNCE_MS = 30_000;
const PLATFORM = process.platform;
const APP_DISPLAY_NAME = 'Lynel Desktop';

/** 从 workDir 派生项目显示名：basename 优先；空则用 sessionId 前 8 */
function deriveProjectName(workDir: string, sessionId: string): string {
  if (workDir) {
    const base = path.basename(workDir);
    if (base) return base;
  }
  return sessionId.slice(0, 8);
}

/** 截断 workDir 用于显示：保留前段 + ... + 末段，长度限制内不省略 */
function compactPath(p: string, max = 48): string {
  if (!p) return '';
  if (p.length <= max) return p;
  const head = Math.ceil((max - 3) / 2);
  const tail = Math.floor((max - 3) / 2);
  return `${p.slice(0, head)}...${p.slice(-tail)}`;
}

export interface AttentionPendingEntry {
  id: string;
  sessionId: string;
  workDir: string;
  projectName: string;
  toolName: string;
  title: string;
  requestAt: number;
  /** 上次发出系统通知的时间戳；0 表示本条尚未通知过 */
  notifiedAt: number;
}

export type PendingChangeHandler = (count: number, entries: AttentionPendingEntry[]) => void;

class WindowAttention {
  private pending = new Map<string, AttentionPendingEntry>();
  private win: BrowserWindow | null = null;
  private onPendingChange: PendingChangeHandler | null = null;
  private dockBouncedThisBurst = false;
  /** 上一次 pending 非空时的快照，用于判断"从 0 变非 0"（触发 dock bounce） */
  private lastSeenCount = 0;

  attachToWindow(win: BrowserWindow): void {
    this.win = win;
  }

  setOnPendingChange(cb: PendingChangeHandler): void {
    this.onPendingChange = cb;
  }

  /** 由 PermissionBroker.onRaise hook 注入 */
  onPermissionRequest(req: { id: string; sessionId: string; workDir?: string; toolName: string }): void {
    const workDir = req.workDir ?? '';
    const entry: AttentionPendingEntry = {
      id: req.id,
      sessionId: req.sessionId,
      workDir,
      projectName: deriveProjectName(workDir, req.sessionId),
      toolName: req.toolName,
      title: this.formatTitle(req.toolName),
      requestAt: Date.now(),
      notifiedAt: 0,
    };
    this.pending.set(req.id, entry);
    this.refresh();
  }

  /** 由 PermissionBroker.onResolve / onCancel hook 注入 */
  onPermissionSettled(id: string): void {
    if (this.pending.delete(id)) {
      this.refresh();
    }
  }

  private formatTitle(toolName: string): string {
    if (toolName === 'Bash') return 'Bash 命令待审批';
    if (toolName === 'Read') return '读取文件待审批';
    if (toolName === 'Write') return '写入文件待审批';
    if (toolName === 'Edit') return '编辑文件待审批';
    if (toolName === 'MultiEdit') return '批量编辑待审批';
    if (toolName === 'AskUserQuestion') return '需要回答问题';
    if (toolName === 'ExitPlanMode') return '需要批准计划';
    return `${toolName} 待审批`;
  }

  private isForeground(): boolean {
    const w = this.win;
    if (!w || w.isDestroyed()) return false;
    return w.isVisible() && !w.isMinimized() && w.isFocused();
  }

  private refresh(): void {
    const count = this.pending.size;
    const needAttention = count > 0 && !this.isForeground();
    const w = this.win;

    // 1) Windows / Linux: 任务栏闪烁
    if (w && !w.isDestroyed()) {
      try {
        w.flashFrame(needAttention);
      } catch (err) {
        logger.warn('flashFrame failed:', err);
      }
    }

    // 2) macOS dock: 仅在"从 0 变非 0"时弹跳一次（informational），badge 跟随 count
    if (PLATFORM === 'darwin' && app.dock) {
      try {
        const grew = count > 0 && this.lastSeenCount === 0;
        if (grew && !this.dockBouncedThisBurst) {
          app.dock.bounce('informational');
          this.dockBouncedThisBurst = true;
        }
        if (count === 0) this.dockBouncedThisBurst = false;
        app.setBadgeCount(needAttention ? count : 0);
      } catch (err) {
        logger.warn('dock update failed:', err);
      }
    } else if (PLATFORM === 'linux') {
      try {
        app.setBadgeCount(needAttention ? count : 0);
      } catch {}
    }

    // 3) 系统通知：needAttention 时，对"未通知过"或"超过 30s"的项目各推一次
    if (needAttention) {
      const now = Date.now();
      for (const e of this.pending.values()) {
        if (e.notifiedAt === 0 || now - e.notifiedAt > NOTIFY_DEBOUNCE_MS) {
          this.showNotification(e);
          e.notifiedAt = now;
        }
      }
    }

    this.lastSeenCount = count;

    // 4) 回调给 tray 重建菜单 + 更新 tooltip
    if (this.onPendingChange) {
      try {
        this.onPendingChange(count, Array.from(this.pending.values()));
      } catch (err) {
        logger.warn('onPendingChange failed:', err);
      }
    }
  }

  private showNotification(entry: AttentionPendingEntry): void {
    if (!Notification.isSupported()) return;
    try {
      const dir = compactPath(entry.workDir);
      const n: NotificationType = new Notification({
        title: `${APP_DISPLAY_NAME} · 权限待审批`,
        body: `${entry.title}\n项目：${entry.projectName}${dir ? `\n目录：${dir}` : ''}`,
        silent: false,
      });
      n.on('click', () => this.focusSession(entry.sessionId));
      n.show();
    } catch (err) {
      logger.warn('notification failed:', err);
    }
  }

  /** 通知点击 / tray "待审批"点击：恢复 + 强制前置 + 聚焦 + 切 tab */
  private focusSession(sessionId: string): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;

    // 1) 最小化 → 还原
    if (w.isMinimized()) w.restore();

    // 2) 隐藏 → 显示
    if (!w.isVisible()) w.show();

    // 3) 强制前置到 z-order 最上层（Windows 在窗口被遮挡时只 show+focus 未必前置）
    //    moveTop 在 Windows 把窗口提到 z-order 顶；macOS 无操作
    try { w.moveTop(); } catch {}

    // 4) 闪烁中先停掉，否则会持续抢焦点
    try { w.flashFrame(false); } catch {}

    // 5) focus
    w.focus();

    // 6) 找 entry 并 emit 切 tab
    const entry = this.pending.get(sessionId) ?? Array.from(this.pending.values()).find((e) => e.sessionId === sessionId);
    const payload = {
      sessionId,
      workDir: entry?.workDir ?? '',
      projectName: entry?.projectName ?? '',
      toolName: entry?.toolName ?? '',
    };
    getBus().emit('attention:focus-session', JSON.stringify(payload));
  }

  /** 托盘点击"待审批"项：聚焦最早一条 */
  focusOldestPending(): void {
    const first = Array.from(this.pending.values()).sort((a, b) => a.requestAt - b.requestAt)[0];
    if (first) this.focusSession(first.sessionId);
  }

  /** 托盘点"显示主窗口"项：纯聚焦，不切 tab */
  focusMainWindow(): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    if (!w.isVisible()) w.show();
    try { w.moveTop(); } catch {}
    try { w.flashFrame(false); } catch {}
    w.focus();
  }

  // 调试 / UI 用
  getPendingCount(): number {
    return this.pending.size;
  }

  getPendingEntries(): AttentionPendingEntry[] {
    return Array.from(this.pending.values());
  }
}

export const windowAttention = new WindowAttention();
