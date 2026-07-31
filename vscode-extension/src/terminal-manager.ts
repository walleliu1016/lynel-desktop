import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { getConfig } from './config.js';
import { newSession, register, remove, setSessionSender, setSessionInputWriter, type Session } from './session.js';
import { APIProxy, resolveAnthropicBaseUrl } from './apiproxy.js';
import { createSettingsOverrideFile } from './settings-helper.js';
import type { WecomManager } from './wecom-manager.js';
import type { WeComChannel } from './channels/wecom-channel.js';
import { getLogger } from './log.js';

const logger = getLogger().scope('terminal');

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
    const botName = botId ? this.wecomManager.getBot(botId)?.name : undefined;
    const label = `Claude ${sessionId.slice(0, 8)}`;
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
    }

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

  /** 查询会话的 bot 绑定信息 */
  getBindingInfo(sessionId: string): { botId: string; botName: string } | undefined {
    const entry = this.terminals.get(sessionId);
    if (!entry?.botId) return undefined;
    const bot = this.wecomManager.getBot(entry.botId);
    if (!bot) return undefined;
    return { botId: entry.botId, botName: bot.name };
  }

  /** 列出所有会话→Bot 绑定 */
  listBindings(): { sessionId: string; sessionLabel: string; botId: string; botName: string; workDir: string }[] {
    const result: { sessionId: string; sessionLabel: string; botId: string; botName: string; workDir: string }[] = [];
    for (const [id, entry] of this.terminals) {
      if (entry.botId) {
        const bot = this.wecomManager.getBot(entry.botId);
        if (bot) {
          result.push({
            sessionId: id,
            sessionLabel: `Claude ${id.slice(0, 8)}`,
            botId: entry.botId,
            botName: bot.name,
            workDir: entry.session.workDir,
          });
        }
      }
    }
    return result;
  }

  /** 切换会话的 Bot 绑定 */
  async switchBotBinding(sessionId?: string): Promise<void> {
    // 如果没有指定会话，让用户选择
    let targetId = sessionId;
    if (!targetId) {
      const entries = Array.from(this.terminals.entries()).map(([id, e]) => ({
        label: `Claude ${id.slice(0, 8)}`,
        description: e.session.workDir,
        detail: e.botId ? `当前绑定: ${this.wecomManager.getBot(e.botId)?.name ?? '未知'}` : '未绑定',
        sessionId: id,
      }));
      if (entries.length === 0) {
        vscode.window.showInformationMessage('没有活跃的终端会话');
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
      placeHolder: `为 Claude ${targetId.slice(0, 8)} 选择 Bot`,
    });
    if (!pick) return;

    const entry = this.terminals.get(targetId);
    if (!entry) return;

    if (pick.label === '$(circle-slash) 取消绑定') {
      if (entry.botId && this.wecomChannel) {
        this.wecomChannel.clearSessionBot(targetId);
      }
      entry.botId = undefined;
      vscode.window.showInformationMessage(`已取消会话 ${targetId.slice(0, 8)} 的 Bot 绑定`);
      return;
    }

    const newBot = bots.find((b) => pick.label.includes(b.name));
    if (!newBot) return;

    // 清除旧绑定
    if (entry.botId && this.wecomChannel) {
      this.wecomChannel.clearSessionBot(targetId);
    }
    // 设置新绑定
    if (this.wecomChannel) {
      this.wecomChannel.setSessionBot(targetId, newBot.id);
    }
    entry.botId = newBot.id;
    vscode.window.showInformationMessage(
      `会话 ${targetId.slice(0, 8)} 已绑定 Bot "${newBot.name}"`,
    );
  }

  /** 直接绑定会话到 Bot（不弹出 QuickPick） */
  bindSession(sessionId: string, botId: string, botName: string): boolean {
    const entry = this.terminals.get(sessionId);
    if (!entry) return false;
    if (entry.botId && this.wecomChannel) {
      this.wecomChannel.clearSessionBot(sessionId);
    }
    if (this.wecomChannel) {
      this.wecomChannel.setSessionBot(sessionId, botId);
    }
    entry.botId = botId;
    return true;
  }

  /** 解绑指定会话的 Bot */
  unbindSession(sessionId: string): boolean {
    const entry = this.terminals.get(sessionId);
    if (!entry) return false;
    if (entry.botId && this.wecomChannel) {
      this.wecomChannel.clearSessionBot(sessionId);
    }
    entry.botId = undefined;
    return true;
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
