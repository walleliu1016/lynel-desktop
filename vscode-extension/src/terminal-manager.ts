import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getConfig } from './config.js';
import { newSession, register, remove, setSessionSender, setSessionInputWriter, type Session } from './session.js';
import { APIProxy, resolveAnthropicBaseUrl } from './apiproxy.js';
import { createSettingsOverrideFile } from './settings-helper.js';
import type { WecomManager } from './wecom-manager.js';
import type { WeComChannel } from './channels/wecom-channel.js';
import { getLogger } from './log.js';
import { addRecentSession, readRecentSessions, updateSessionBotBinding, type RecentSessionRecord } from './desktop-data.js';

const logger = getLogger().scope('terminal');

/** 终端命名策略，与 Desktop 端一致：userTitle > aiTitle > project > sessionId。
 *  有 recent 记录时优先用其中的标题字段；新建会话直接回落 project/sessionId。 */
function resolveTerminalLabel(sessionId: string, workDir: string, recent?: RecentSessionRecord): string {
  const project = path.basename(workDir) || workDir;
  return recent
    ? (recent.userTitle || recent.aiTitle || recent.project || project || sessionId.slice(0, 8))
    : (project || sessionId.slice(0, 8));
}

interface TerminalEntry {
  terminal: vscode.Terminal;
  proxy: APIProxy;
  session: Session;
  cleanupSettings: () => void;
  botId?: string;
}

export class TerminalManager implements vscode.Disposable {
  private terminals = new Map<string, TerminalEntry>();
  private hookPort: number;
  private wecomManager: WecomManager;
  private wecomChannel?: WeComChannel;
  private _onDidChangeCount = new vscode.EventEmitter<number>();
  readonly onDidChangeCount = this._onDidChangeCount.event;
  private closeListener: vscode.Disposable;

  constructor(hookPort: number, wecomManager: WecomManager, wecomChannel?: WeComChannel) {
    this.hookPort = hookPort;
    this.wecomManager = wecomManager;
    this.wecomChannel = wecomChannel;

    // 注入 session send/writeInput 回调（供 WeComChannel 用）
    setSessionSender((id, text) => {
      const normalized = /[\r\n]$/.test(text) ? text : text + '\r';
      this.terminals.get(id)?.terminal.sendText(normalized);
    });
    setSessionInputWriter((id, data) => {
      this.terminals.get(id)?.terminal.sendText(data, false);
    });

    this.closeListener = vscode.window.onDidCloseTerminal((closed) => {
      this.handleTerminalClosed(closed);
    });
  }

  async createTerminal(workDir?: string, botId?: string): Promise<vscode.Terminal> {
    const sessionId = randomUUID();
    const cwd = workDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const config = getConfig();

    // 如果用户没指定 botId，尝试从 Desktop 的 recent-sessions 读取历史绑定
    if (!botId) {
      botId = readRecentSessions().find((r) => r.sessionId === sessionId)?.botId;
    }

    const botName = botId ? this.wecomManager.getBot(botId)?.name : undefined;
    const label = resolveTerminalLabel(sessionId, cwd);
    const name = botName ? `${label} [${botName}]` : label;
    logger.info(`createTerminal ${name} cwd=${cwd}${botId ? ` bot=${botId.slice(0, 8)}` : ''} hookPort=${this.hookPort}`);

    const upstream = resolveAnthropicBaseUrl();
    const proxy = new APIProxy(sessionId, cwd, upstream);
    logger.info(`proxy upstream=${upstream}`);

    // 将 APIProxy 活动事件转发到 WeComChannel
    proxy.onActivity = (activity) => {
      logger.info(`APIProxy activity seq=${activity.seq} sid=${sessionId.slice(0, 8)} prompt=${activity.prompt.slice(0, 50)} text=${activity.text.slice(0, 50)} tools=${activity.toolUses.length}`);
      void this.wecomChannel?.sendApiActivity(sessionId, activity);
    };

    let proxyPort = 0;
    try { proxyPort = await proxy.start(); } catch (err) {
      logger.error('APIProxy start failed:', err);
    }

    const session = newSession(sessionId, cwd);
    register(session);

    // 绑定 bot 到 session
    if (botId && this.wecomChannel) {
      this.wecomChannel.setSessionBot(sessionId, botId);
      updateSessionBotBinding(sessionId, botId);
    }

    // 同步到 Desktop 的 recent-sessions.json。
    // 新建会话不写 userTitle（机器生成的终端名不应占用用户自定义位），
    // 让命名回落 aiTitle / project，由 Desktop 端负责。
    void addRecentSession({
      sessionId,
      workdir: cwd,
      project: path.basename(cwd) || cwd,
      aiTitle: '',
      firstPrompt: '',
      lastOpenedAt: Date.now(),
      state: 'running',
      botId,
    });

    const proxyUrl = proxyPort > 0 ? `http://127.0.0.1:${proxyPort}` : '';
    if (proxyUrl) {
      logger.info(`proxy started on port ${proxyPort}`);
    } else {
      logger.warn('proxy port is 0 — Claude API calls will NOT be intercepted');
    }

    // ANTHROPIC_BASE_URL 通过临时 settings.json 的 env 字段注入（Claude CLI 从 settings 读取）
    const override = proxyUrl
      ? createSettingsOverrideFile(this.hookPort, proxyUrl)
      : createSettingsOverrideFile(this.hookPort, '');
    const shellArgs = ['--session-id', sessionId, ...override.args];

    const terminal = vscode.window.createTerminal({
      name,
      shellPath: config.claudeBin,
      shellArgs,
      cwd,
      iconPath: new vscode.ThemeIcon('comment-discussion'),
    });

    this.terminals.set(sessionId, {
      terminal, proxy, session, cleanupSettings: override.cleanup, botId,
    });
    this._onDidChangeCount.fire(this.terminals.size);
    terminal.show();

    vscode.window.showInformationMessage(
      botName ? `Lynel: ${label} 已绑定 "${botName}"` : `Lynel: ${label}`,
    );
    return terminal;
  }

  /** 查询会话的 bot 绑定信息（优先从 recent-sessions.json 读取） */
  getBindingInfo(sessionId: string): { botId: string; botName: string } | undefined {
    const botId = this.terminals.get(sessionId)?.botId ?? readRecentSessions().find((r) => r.sessionId === sessionId)?.botId;
    if (!botId) return undefined;
    const bot = this.wecomManager.getBot(botId);
    if (!bot) return undefined;
    return { botId, botName: bot.name };
  }

  /** 列出所有会话→Bot 绑定 */
  listBindings(): { sessionId: string; sessionLabel: string; botId: string; botName: string; workDir: string }[] {
    const result: { sessionId: string; sessionLabel: string; botId: string; botName: string; workDir: string }[] = [];
    const seen = new Set<string>();
    // 当前运行的终端
    for (const [id, entry] of this.terminals) {
      if (entry.botId) {
        const bot = this.wecomManager.getBot(entry.botId);
        if (bot) {
          seen.add(id);
          result.push({
            sessionId: id,
            sessionLabel: entry.terminal.name,
            botId: entry.botId,
            botName: bot.name,
            workDir: entry.session.workDir,
          });
        }
      }
    }
    // recent-sessions 里的绑定
    for (const r of readRecentSessions()) {
      if (!r.botId || seen.has(r.sessionId)) continue;
      const bot = this.wecomManager.getBot(r.botId);
      if (bot) {
        result.push({
          sessionId: r.sessionId,
          sessionLabel: r.userTitle || `Claude ${r.sessionId.slice(0, 8)}`,
          botId: r.botId,
          botName: bot.name,
          workDir: r.workdir,
        });
      }
    }
    return result;
  }

  /** 切换会话的 Bot 绑定 */
  async switchBotBinding(sessionId?: string): Promise<void> {
    // 如果没有指定会话，让用户选择
    let targetId = sessionId;
    if (!targetId) {
      const sessions = this.listAllSessions();
      const entries = sessions.map((s) => ({
        label: s.userTitle || s.label,
        description: s.workDir,
        detail: s.botId ? `当前绑定: ${this.wecomManager.getBot(s.botId)?.name ?? '未知'}` : '未绑定',
        sessionId: s.id,
      }));
      if (entries.length === 0) {
        vscode.window.showInformationMessage('没有会话');
        return;
      }
      const pick = await vscode.window.showQuickPick(entries, {
        placeHolder: '选择要切换 Bot 绑定的会话',
      });
      if (!pick) return;
      targetId = pick.sessionId;
    }

    const bots = this.wecomManager.getBots();
    const items: vscode.QuickPickItem[] = [
      ...bots.map((b) => ({
        label: `$(comment-discussion) ${b.name}`,
        description: `Bot ID: ${b.botId}`,
        detail: b.chatId ? `Chat: ${b.chatId}` : '',
      })),
      { label: '$(circle-slash) 取消绑定', description: '移除当前 Bot 绑定' },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `为会话选择 Bot`,
    });
    if (!pick) return;

    if (pick.label === '$(circle-slash) 取消绑定') {
      this.applyBotBinding(targetId, undefined);
      vscode.window.showInformationMessage(`已取消会话的 Bot 绑定`);
      return;
    }

    const newBot = bots.find((b) => pick.label.includes(b.name));
    if (!newBot) return;

    this.applyBotBinding(targetId, newBot.id);
    vscode.window.showInformationMessage(
      `会话已绑定 Bot "${newBot.name}"`,
    );
  }

  /** 直接绑定会话到 Bot（不弹出 QuickPick） */
  bindSession(sessionId: string, botId: string, botName: string): boolean {
    return this.applyBotBinding(sessionId, botId);
  }

  /** 解绑指定会话的 Bot */
  unbindSession(sessionId: string): boolean {
    return this.applyBotBinding(sessionId, undefined);
  }

  private applyBotBinding(sessionId: string, botId: string | undefined): boolean {
    const entry = this.terminals.get(sessionId);
    if (entry) {
      if (entry.botId && this.wecomChannel) {
        this.wecomChannel.clearSessionBot(sessionId);
      }
      if (botId && this.wecomChannel) {
        this.wecomChannel.setSessionBot(sessionId, botId);
      }
      entry.botId = botId;
    }
    // 无论是否是当前运行的终端，都同步到 recent-sessions.json
    return updateSessionBotBinding(sessionId, botId);
  }

  getSessionIds(): string[] {
    return Array.from(this.terminals.keys());
  }

  /** 创建终端并选择 Bot 绑定 */
  async createTerminalWithBot(workDir?: string): Promise<vscode.Terminal | undefined> {
    const bots = this.wecomManager.getBots();
    if (bots.length === 0) {
      const bind = await vscode.window.showInformationMessage(
        '没有已绑定的企业微信 Bot，是否现在绑定？', '绑定 Bot',
      );
      if (bind) {
        await vscode.commands.executeCommand('lynel.bindWecomBot');
      }
      return this.createTerminal(workDir);
    }

    const items: vscode.QuickPickItem[] = [
      ...bots.map((b) => ({
        label: `$(comment-discussion) ${b.name}`,
        description: `Bot ID: ${b.botId}`,
        detail: b.chatId ? `Chat: ${b.chatId}` : '',
      })),
      { label: '$(circle-slash) 不绑定 Bot', description: '创建独立的终端会话' },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要绑定的企业微信 Bot',
    });
    if (!pick) return undefined;

    if (pick.label === '$(circle-slash) 不绑定 Bot') {
      return this.createTerminal(workDir);
    }

    const selectedBot = bots.find((b) => pick.label.includes(b.name));
    return this.createTerminal(workDir, selectedBot?.id);
  }

  sendText(sessionId: string, text: string): boolean {
    const entry = this.terminals.get(sessionId);
    if (!entry) return false;
    entry.terminal.sendText(text);
    return true;
  }

  getTerminal(sessionId: string): vscode.Terminal | undefined {
    return this.terminals.get(sessionId)?.terminal;
  }

  private async handleTerminalClosed(closed: vscode.Terminal): Promise<void> {
    for (const [id, entry] of this.terminals) {
      if (entry.terminal === closed) {
        logger.info(`terminal closed ${id.slice(0, 8)}`);
        if (entry.botId && this.wecomChannel) {
          this.wecomChannel.clearSessionBot(id);
        }
        entry.cleanupSettings();
        try { await entry.proxy.close(); } catch { /* ok */ }
        remove(id);
        this.terminals.delete(id);
        this._onDidChangeCount.fire(this.terminals.size);
        return;
      }
    }
  }

  getTerminalCount(): number { return this.terminals.size; }

  /** 列出当前 VS Code 运行的会话 */
  listSessions(): { id: string; label: string; project: string; workDir: string; botId?: string; isRunning: boolean }[] {
    const result: { id: string; label: string; project: string; workDir: string; botId?: string; isRunning: boolean }[] = [];
    for (const [id, entry] of this.terminals) {
      const project = path.basename(entry.session.workDir) || entry.session.workDir;
      result.push({
        id,
        label: entry.terminal.name,
        project,
        workDir: entry.session.workDir,
        botId: entry.botId,
        isRunning: true,
      });
    }
    return result;
  }

  /** 合并 recent-sessions.json 与当前运行会话，用于 TreeView */
  listAllSessions(): { id: string; label: string; title: string; project: string; workDir: string; botId?: string; botName?: string; isRunning: boolean; userTitle?: string; lastOpenedAt: number; meta: RecentSessionRecord }[] {
    const result = new Map<string, { id: string; label: string; title: string; project: string; workDir: string; botId?: string; botName?: string; isRunning: boolean; userTitle?: string; lastOpenedAt: number; meta: RecentSessionRecord }>();
    for (const s of this.listSessions()) {
      const project = s.project || path.basename(s.workDir) || s.workDir;
      const meta: RecentSessionRecord = {
        sessionId: s.id,
        workdir: s.workDir,
        project,
        aiTitle: '',
        firstPrompt: '',
        userTitle: s.label,
        lastOpenedAt: Date.now(),
        state: 'running',
        botId: s.botId,
      };
      result.set(s.id, {
        id: s.id,
        label: s.label,
        title: s.label || project,
        project,
        workDir: s.workDir,
        botId: s.botId,
        botName: s.botId ? this.wecomManager.getBot(s.botId)?.name : undefined,
        isRunning: true,
        userTitle: s.label,
        lastOpenedAt: Date.now(),
        meta,
      });
    }
    for (const r of readRecentSessions()) {
      const project = r.project || path.basename(r.workdir) || r.workdir;
      const title = r.userTitle || r.aiTitle || r.firstPrompt || project || r.sessionId.slice(0, 8);
      if (result.has(r.sessionId)) {
        const existing = result.get(r.sessionId)!;
        existing.botId = existing.botId || r.botId;
        existing.botName = existing.botId ? this.wecomManager.getBot(existing.botId)?.name : undefined;
        existing.userTitle = r.userTitle || existing.userTitle;
        existing.title = title;
        existing.lastOpenedAt = r.lastOpenedAt;
        existing.meta = { ...existing.meta, ...r };
        continue;
      }
      result.set(r.sessionId, {
        id: r.sessionId,
        label: title,
        title,
        project,
        workDir: r.workdir,
        botId: r.botId,
        botName: r.botId ? this.wecomManager.getBot(r.botId)?.name : undefined,
        isRunning: false,
        userTitle: r.userTitle,
        lastOpenedAt: r.lastOpenedAt,
        meta: r,
      });
    }
    return Array.from(result.values()).sort((a, b) => {
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
      return (a.userTitle || a.label).localeCompare(b.userTitle || b.label);
    });
  }

  /** 恢复一个 Desktop 或 recent-sessions 里的会话 */
  async resumeSession(sessionId: string, workDir?: string): Promise<vscode.Terminal | undefined> {
    if (this.terminals.has(sessionId)) {
      this.terminals.get(sessionId)!.terminal.show();
      return this.terminals.get(sessionId)!.terminal;
    }

    const recent = readRecentSessions().find((r) => r.sessionId === sessionId);
    const cwd = workDir ?? recent?.workdir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const config = getConfig();
    const botId = recent?.botId;
    const botName = botId ? this.wecomManager.getBot(botId)?.name : undefined;
    const label = resolveTerminalLabel(sessionId, cwd, recent);
    const name = botName ? `${label} [${botName}]` : label;
    logger.info(`resumeTerminal ${name} cwd=${cwd}${botId ? ` bot=${botId.slice(0, 8)}` : ''} hookPort=${this.hookPort}`);

    const upstream = resolveAnthropicBaseUrl();
    const proxy = new APIProxy(sessionId, cwd, upstream);
    let proxyPort = 0;
    try { proxyPort = await proxy.start(); } catch (err) {
      logger.error('APIProxy start failed:', err);
    }

    const session = newSession(sessionId, cwd);
    register(session);

    if (botId && this.wecomChannel) {
      this.wecomChannel.setSessionBot(sessionId, botId);
    }

    void addRecentSession({
      sessionId,
      workdir: cwd,
      project: path.basename(cwd) || cwd,
      aiTitle: recent?.aiTitle ?? '',
      firstPrompt: recent?.firstPrompt ?? '',
      lastOpenedAt: Date.now(),
      state: 'running',
      botId,
    });

    const proxyUrl = proxyPort > 0 ? `http://127.0.0.1:${proxyPort}` : '';
    const override = proxyUrl
      ? createSettingsOverrideFile(this.hookPort, proxyUrl)
      : createSettingsOverrideFile(this.hookPort, '');
    const shellArgs = ['--resume', sessionId, ...override.args];

    const terminal = vscode.window.createTerminal({
      name,
      shellPath: config.claudeBin,
      shellArgs,
      cwd,
      iconPath: new vscode.ThemeIcon('comment-discussion'),
    });

    this.terminals.set(sessionId, {
      terminal, proxy, session, cleanupSettings: override.cleanup, botId,
    });
    this._onDidChangeCount.fire(this.terminals.size);
    terminal.show();
    return terminal;
  }

  closeAll(): void {
    for (const [id, entry] of this.terminals) {
      if (entry.botId && this.wecomChannel) this.wecomChannel.clearSessionBot(id);
      entry.cleanupSettings();
      entry.terminal.dispose();
      entry.proxy.close().catch(() => {});
      remove(id);
    }
    this.terminals.clear();
    this._onDidChangeCount.fire(0);
  }

  dispose(): void {
    this.closeAll();
    this._onDidChangeCount.dispose();
    this.closeListener.dispose();
  }
}
