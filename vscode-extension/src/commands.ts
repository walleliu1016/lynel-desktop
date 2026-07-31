import * as vscode from 'vscode';
import type { TerminalManager } from './terminal-manager.js';
import type { WecomManager } from './wecom-manager.js';

function getWorkDir(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

export function registerCommands(
  context: vscode.ExtensionContext,
  terminalManager: TerminalManager,
  wecomManager: WecomManager,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.newTerminal', async () => {
      await terminalManager.createTerminalWithBot(getWorkDir());
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.newTerminalWithWorkDir', async () => {
      await terminalManager.createTerminalWithBot(getWorkDir());
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.closeAllTerminals', () => {
      terminalManager.closeAll();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.showSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'lynel');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.bindWecomBot', async () => {
      await wecomManager.addBot();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.manageWecomBots', async () => {
      await showBotDashboard(wecomManager, terminalManager);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lynel.switchBotBinding', async () => {
      await terminalManager.switchBotBinding();
    }),
  );
}

/** Bot 管理面板：展示所有 Bot、绑定的会话、支持切换/解绑/删除 */
async function showBotDashboard(
  wecomManager: WecomManager,
  terminalManager: TerminalManager,
): Promise<void> {
  const bots = wecomManager.getBots();
  const bindings = terminalManager.listBindings();

  if (bots.length === 0) {
    const add = await vscode.window.showInformationMessage(
      '暂无企业微信 Bot，是否绑定？', '绑定 Bot',
    );
    if (add) await wecomManager.addBot();
    return;
  }

  while (true) {
    const items: vscode.QuickPickItem[] = [];
    for (const bot of bots) {
      const count = bindings.filter((b) => b.botId === bot.id).length;
      items.push({
        label: `$(comment-discussion) ${bot.name}`,
        description: `${count} 个会话`,
        detail: `Bot ID: ${bot.botId} | Chat: ${bot.chatId || '(未设置)'}`,
      });
    }
    items.push({ label: '$(add) 绑定新 Bot', description: '' });

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Bot 管理面板 — 选择 Bot 查看详情或操作',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!pick) return;

    if (pick.label === '$(add) 绑定新 Bot') {
      await wecomManager.addBot();
      return;
    }

    const botName = pick.label.replace(/^\$\(comment-discussion\)\s*/, '');
    const bot = bots.find((b) => b.name === botName);
    if (!bot) continue;

    const bound = bindings.filter((b) => b.botId === bot.id);
    const actionItems: vscode.QuickPickItem[] = [];

    if (bound.length > 0) {
      actionItems.push({
        label: `$(list-tree) 查看已绑定会话 (${bound.length})`,
        description: '选择单个会话解绑',
      });
    }
    actionItems.push(
      { label: '$(plug) 绑定终端会话', description: '选择活跃终端绑定到此 Bot' },
      { label: '$(edit) 重命名', description: '' },
      { label: '$(trash) 删除 Bot', description: '永久删除此 Bot 配置' },
    );
    if (bound.length > 0) {
      actionItems.push({
        label: `$(unplug) 解绑全部 (${bound.length} 个会话)`,
        description: '移除所有绑定',
      });
    }

    const action = await vscode.window.showQuickPick(actionItems, {
      placeHolder: `Bot: ${bot.name}`,
    });
    if (!action) continue;

    if (action.label.includes('查看已绑定会话')) {
      await showAndUnbindSessions(bot, bound, terminalManager);
      return;
    } else if (action.label.includes('绑定终端会话')) {
      await bindTerminalToBot(bot, terminalManager);
      return;
    } else if (action.label.includes('解绑全部')) {
      const confirm = await vscode.window.showWarningMessage(
        `确定解绑 "${bot.name}" 的所有 ${bound.length} 个会话？`,
        { modal: true }, '解绑全部',
      );
      if (confirm === '解绑全部') {
        for (const b of bound) terminalManager.unbindSession(b.sessionId);
        vscode.window.showInformationMessage(`已解绑 ${bound.length} 个会话`);
      }
      return;
    } else if (action.label.includes('重命名')) {
      const newName = await vscode.window.showInputBox({
        prompt: '新名称', value: bot.name,
      });
      if (newName && wecomManager.renameBot(bot.id, newName)) {
        // 更新终端名称
        for (const b of terminalManager.listBindings().filter((b) => b.botId === bot.id)) {
          terminalManager.bindSession(b.sessionId, bot.id, newName);
        }
        vscode.window.showInformationMessage(`已更名为 "${newName}"`);
      }
      return;
    } else if (action.label.includes('删除')) {
      const msg = bound.length > 0
        ? `Bot "${bot.name}" 有 ${bound.length} 个绑定的会话，删除后这些会话将不再转发消息。确定删除？`
        : `确定删除 Bot "${bot.name}"？`;
      const confirm = await vscode.window.showWarningMessage(msg, { modal: true }, '删除');
      if (confirm === '删除') {
        for (const b of bound) terminalManager.unbindSession(b.sessionId);
        wecomManager.deleteBot(bot.id);
        vscode.window.showInformationMessage(`Bot "${bot.name}" 已删除`);
      }
      return;
    }
  }
}

/** 展示 Bot 绑定的会话，选择单个解绑 */
async function showAndUnbindSessions(
  bot: { id: string; name: string },
  bound: { sessionId: string; sessionLabel: string; workDir: string }[],
  terminalManager: TerminalManager,
): Promise<void> {
  const items: vscode.QuickPickItem[] = bound.map((b) => ({
    label: b.sessionLabel,
    description: b.workDir,
    sessionId: b.sessionId,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `"${bot.name}" 绑定的会话 — 选择以解绑`,
  });
  if (!pick) return;

  const sid = (pick as any).sessionId as string;
  if (terminalManager.unbindSession(sid)) {
    vscode.window.showInformationMessage(
      `已解绑会话 ${sid.slice(0, 8)} 与 Bot "${bot.name}"`,
    );
  }
}

/** 选择活跃终端绑定到指定 Bot */
async function bindTerminalToBot(
  bot: { id: string; name: string },
  terminalManager: TerminalManager,
): Promise<void> {
  const sessionIds = terminalManager.getSessionIds();
  if (sessionIds.length === 0) {
    vscode.window.showInformationMessage('没有活跃的终端会话，请先创建终端');
    return;
  }

  const entries = sessionIds.map((id) => {
    const info = terminalManager.getBindingInfo(id);
    return {
      label: `Claude ${id.slice(0, 8)}`,
      description: info ? `当前: ${info.botName}` : '未绑定',
      sessionId: id,
    };
  });

  const pick = await vscode.window.showQuickPick(entries, {
    placeHolder: `选择要绑定到 "${bot.name}" 的终端`,
  });
  if (!pick) return;

  if (terminalManager.bindSession(pick.sessionId, bot.id, bot.name)) {
    vscode.window.showInformationMessage(
      `会话 ${pick.sessionId.slice(0, 8)} 已绑定 "${bot.name}"`,
    );
  }
}
