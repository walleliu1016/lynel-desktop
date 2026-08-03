import * as vscode from 'vscode';
import type { TerminalManager } from './terminal-manager.js';
import type { RecentSessionRecord } from './desktop-data.js';

export interface LynelSessionItem {
  id: string;
  title: string;
  project: string;
  workDir: string;
  botId?: string;
  botName?: string;
  isRunning: boolean;
  lastOpenedAt: number;
  meta: RecentSessionRecord;
}

export interface LynelSessionGroup {
  id: 'running' | 'history';
  label: string;
  sessions: LynelSessionItem[];
}

export type LynelTreeNode = LynelSessionGroup | LynelSessionItem;

function displayTitle(meta: RecentSessionRecord): string {
  return meta.userTitle || meta.aiTitle || meta.firstPrompt || meta.project || meta.sessionId.slice(0, 8) || '新会话';
}

function formatDuration(lastOpenedAt: number): string {
  if (!lastOpenedAt || lastOpenedAt <= 0) return '刚刚';
  const ms = Date.now() - lastOpenedAt;
  if (ms < 0) return '刚刚';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mon = Math.floor(day / 30);
  if (mon > 12) return '很久以前';
  return `${mon}mo`;
}

class GroupTreeItem extends vscode.TreeItem {
  constructor(public readonly group: LynelSessionGroup) {
    super(group.label, group.id === 'running'
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `lynel-group-${group.id}`;
    this.contextValue = 'lynelSessionGroup';
    this.iconPath = new vscode.ThemeIcon(group.id === 'running' ? 'play-circle' : 'history');
    this.description = `${group.sessions.length}`;
  }
}

class SessionTreeItem extends vscode.TreeItem {
  constructor(public readonly session: LynelSessionItem) {
    super(session.title, vscode.TreeItemCollapsibleState.None);
    this.id = `lynel-session-${session.id}`;

    const parts: string[] = [session.project];
    parts.push(formatDuration(session.lastOpenedAt));
    if (session.botName) {
      parts.push(`Bot: ${session.botName}`);
    }
    this.description = parts.join(' · ');

    this.tooltip = `${session.isRunning ? '● 运行中' : '○ 历史会话'}\n标题: ${session.title}\n项目: ${session.project}\n目录: ${session.workDir}${session.botName ? `\nBot: ${session.botName}` : ''}\nID: ${session.id}`;
    this.iconPath = new vscode.ThemeIcon(session.isRunning ? 'play-circle' : 'circle-outline');
    this.contextValue = 'lynelSession';
    // 点击行 → 打开/恢复会话；inline 按钮独立处理 Bot 绑定与关闭
    this.command = {
      command: 'lynel.focusOrResumeTerminal',
      title: '打开或恢复会话',
      arguments: [session.id],
    };
  }
}

export class LynelTreeDataProvider implements vscode.TreeDataProvider<LynelTreeNode>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<LynelTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private eventDisposable: vscode.Disposable;

  constructor(private terminalManager: TerminalManager) {
    this.eventDisposable = terminalManager.onDidChangeCount(() => {
      this.refresh();
    });
  }

  getTreeItem(element: LynelTreeNode): vscode.TreeItem {
    if ('sessions' in element) {
      return new GroupTreeItem(element);
    }
    return new SessionTreeItem(element);
  }

  getChildren(element?: LynelTreeNode): LynelTreeNode[] {
    if (!element) {
      return this.buildGroups();
    }
    if ('sessions' in element) {
      return element.sessions;
    }
    return [];
  }

  private buildGroups(): LynelSessionGroup[] {
    const all = this.terminalManager.listAllSessions();
    const running: LynelSessionItem[] = [];
    const history: LynelSessionItem[] = [];

    for (const s of all) {
      const item: LynelSessionItem = {
        id: s.id,
        title: displayTitle(s.meta) || s.title,
        project: s.project,
        workDir: s.workDir,
        botId: s.botId,
        botName: s.botName,
        isRunning: s.isRunning,
        lastOpenedAt: s.lastOpenedAt,
        meta: s.meta,
      };
      if (s.isRunning) {
        running.push(item);
      } else {
        history.push(item);
      }
    }

    const groups: LynelSessionGroup[] = [];
    if (running.length > 0) {
      groups.push({ id: 'running', label: '运行中', sessions: running });
    }
    if (history.length > 0 || running.length === 0) {
      groups.push({ id: 'history', label: '历史会话', sessions: history });
    }
    return groups;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this.eventDisposable.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
