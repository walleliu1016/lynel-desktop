import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { readDesktopBots, writeDesktopBots, type BotConfig } from './desktop-data.js';

export { type BotConfig } from './desktop-data.js';

export class WecomManager implements vscode.Disposable {
  private bots = new Map<string, BotConfig>();
  private disposables: vscode.Disposable[] = [];
  onBotsChanged: ((bots: BotConfig[]) => void) | null = null;

  constructor() {
    this.loadBots();
  }

  private loadBots(): void {
    const bots = readDesktopBots();
    this.bots.clear();
    for (const [id, bot] of Object.entries(bots)) {
      this.bots.set(id, bot);
    }
  }

  private saveBots(): void {
    writeDesktopBots(Object.fromEntries(this.bots));
  }

  async addBot(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Bot 名称（用于标识）',
      placeHolder: '例如：我的企微 Bot',
    });
    if (!name) return;

    const botId = await vscode.window.showInputBox({
      prompt: 'Bot ID',
      placeHolder: '从企业微信管理后台获取',
    });
    if (!botId) return;

    const secret = await vscode.window.showInputBox({
      prompt: 'Bot Secret',
      placeHolder: '从企业微信管理后台获取',
      password: true,
    });
    if (!secret) return;

    const chatId = await vscode.window.showInputBox({
      prompt: '默认 Chat ID（可选，用于消息路由）',
      placeHolder: '不填则使用当前登录账户',
    });
    if (chatId === undefined) return; // ESC 取消

    const id = randomUUID();
    const now = Date.now();
    const bot: BotConfig = {
      id, name, source: 'wecom', botId, secret,
      chatId: chatId || '',
      createdAt: now, updatedAt: now,
    };

    this.bots.set(id, bot);
    this.saveBots();
    this.notifyBotsChanged();
    vscode.window.showInformationMessage(`企业微信 Bot "${name}" 已绑定`);
  }

  async manageBots(): Promise<void> {
    const bots = Array.from(this.bots.values());
    if (bots.length === 0) {
      const add = await vscode.window.showInformationMessage(
        '暂无绑定的企业微信 Bot，是否立即绑定？',
        '绑定',
      );
      if (add) await this.addBot();
      return;
    }

    const items = bots.map((b) => ({
      label: `$(comment-discussion) ${b.name}`,
      description: `Bot ID: ${b.botId}`,
      detail: `Chat ID: ${b.chatId || '(未设置)'} | 创建: ${new Date(b.createdAt).toLocaleDateString()}`,
      botId: b.id,
    }));

    items.push({
      label: '$(add) 绑定新的 Bot',
      description: '',
      detail: '',
      botId: '',
    });

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: '选择 Bot 管理操作',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!pick) return;

    if (!pick.botId) {
      await this.addBot();
      return;
    }

    const action = await vscode.window.showQuickPick(
      [
        { label: '$(trash) 删除 Bot', action: 'delete' },
        { label: '$(edit) 修改名称', action: 'rename' },
      ],
      { placeHolder: `操作: ${pick.label}` },
    );
    if (!action) return;

    if (action.action === 'delete') {
      const confirm = await vscode.window.showWarningMessage(
        `确定要删除 Bot "${pick.label}" 吗？`,
        { modal: true },
        '删除',
      );
      if (confirm === '删除') {
        this.bots.delete(pick.botId);
        this.saveBots();
        vscode.window.showInformationMessage(`Bot "${pick.label}" 已删除`);
      }
    } else if (action.action === 'rename') {
      const newName = await vscode.window.showInputBox({
        prompt: '新名称',
        value: pick.label.replace(/^\$\(comment-discussion\)\s*/, ''),
      });
      if (newName) {
        const bot = this.bots.get(pick.botId);
        if (bot) {
          bot.name = newName;
          bot.updatedAt = Date.now();
          this.saveBots();
          vscode.window.showInformationMessage(`Bot 已更名为 "${newName}"`);
        }
      }
    }
  }

  private notifyBotsChanged(): void {
    if (this.onBotsChanged) {
      this.onBotsChanged(Array.from(this.bots.values()));
    }
  }

  getBot(id: string): BotConfig | undefined {
    return this.bots.get(id);
  }

  getBots(): BotConfig[] {
    return Array.from(this.bots.values());
  }

  renameBot(id: string, newName: string): boolean {
    const bot = this.bots.get(id);
    if (!bot) return false;
    bot.name = newName;
    bot.updatedAt = Date.now();
    this.saveBots();
    this.notifyBotsChanged();
    return true;
  }

  deleteBot(id: string): boolean {
    if (!this.bots.has(id)) return false;
    this.bots.delete(id);
    this.saveBots();
    this.notifyBotsChanged();
    return true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
