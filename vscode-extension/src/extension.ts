import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TerminalManager } from './terminal-manager.js';
import { StatusBarManager } from './status-bar.js';
import { registerCommands } from './commands.js';
import { preloadEnv } from './pty-bridge.js';
import { HookServer } from './hookserver.js';
import { permissionBroker } from './permission-broker.js';
import { WecomManager } from './wecom-manager.js';
import { WeComChannel } from './channels/wecom-channel.js';
import { getConfig } from './config.js';
import { getLogger, disposeLogger } from './log.js';

const logger = getLogger();

import { LynelTreeDataProvider } from './tree-provider.js';

let terminalManager: TerminalManager;
let statusBar: StatusBarManager;
let hookServer: HookServer;
let wecomManager: WecomManager;
let wecomChannel: WeComChannel;
let treeProvider: LynelTreeDataProvider;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.info('activate start');
  vscode.window.showInformationMessage('Lynel 扩展已激活');

  // 连通性诊断：测试能否直连 api.anthropic.com
  void (async () => {
    const https = await import('node:https');
    logger.info(`network test: connecting to api.anthropic.com...`);
    const req = https.request({ hostname: 'api.anthropic.com', path: '/', method: 'HEAD', timeout: 10000 }, (res) => {
      logger.info(`network test OK: status=${res.statusCode}`);
      res.resume();
    });
    req.on('error', (err: any) => {
      logger.error(`network test FAILED: ${err.code} ${err.message}`);
    });
    req.on('socket', (sock: any) => {
      sock.once('lookup', (err: any, addr: string) => {
        logger.info(`network test: DNS resolved to ${addr}`);
      });
    });
    req.end();
  })();

  await preloadEnv();

  hookServer = new HookServer(permissionBroker);
  const hookPort = await hookServer.start();
  console.log('[Lynel] HookServer started on port', hookPort);

  const config = getConfig();
  wecomManager = new WecomManager();

  // 初始化 WeComChannel 并连接已配置的 bots
  wecomChannel = new WeComChannel({ enabled: true });
  const bots = wecomManager.getBots();
  if (bots.length > 0) {
    wecomChannel.updateBots(bots);
    console.log(`[Lynel] WeComChannel started with ${bots.length} bots`);
  }

  // Bot 变化时自动同步到 WeComChannel（增/删/改）
  wecomManager.onBotsChanged = (updatedBots) => {
    wecomChannel.updateBots(updatedBots);
  };

  // HookServer 事件 → WeComChannel
  hookServer.onPermissionRequest(async (evt) => {
    try {
      const sid = evt.session_id || '';
      const result = await permissionBroker.wait({
        id: sid + '::' + (evt.tool_name || 'unknown'),
        sessionId: sid,
        workDir: (evt as any).work_dir || process.cwd(),
        toolName: evt.tool_name || 'unknown',
        toolInput: evt.tool_input || evt.request || {},
      });
      return { allowed: result.decision === 'allow', answers: result.answers };
    } catch {
      return { allowed: false };
    }
  });

  hookServer.onEvent((evt) => {
    // 转发到 WeComChannel
    if (evt.hook_event_name === 'PermissionRequest' && wecomChannel?.isEnabled()) {
      const hookEvent = {
        kind: 'PermissionRequest' as const,
        sessionId: evt.session_id || '',
        workDir: (evt as any).work_dir || '',
        payload: {
          id: evt.session_id + '::' + (evt.tool_name || ''),
          toolName: evt.tool_name,
          toolInput: evt.tool_input,
        },
      };
      wecomChannel.sendHook(hookEvent);
    }
  });

  terminalManager = new TerminalManager(hookPort, wecomManager, wecomChannel);
  statusBar = new StatusBarManager(terminalManager);
  treeProvider = new LynelTreeDataProvider(terminalManager);

  // 尽早注册命令，避免后续初始化失败导致按钮/菜单失效
  registerCommands(context, terminalManager, wecomManager);

  const treeView = vscode.window.createTreeView('lynel.sessions', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // 监听 Desktop 数据文件变化，自动刷新侧边栏（个别文件被删除时不能中断激活）
  const watchDir = path.join(os.homedir(), '.lynel-desktop');
  const filesToWatch = ['recent-sessions.json', 'settings.json'];
  const watchers: fs.FSWatcher[] = [];
  for (const file of filesToWatch) {
    try {
      const filePath = path.join(watchDir, file);
      if (fs.existsSync(filePath)) {
        const watcher = fs.watch(filePath, () => {
          treeProvider.refresh();
        });
        watchers.push(watcher);
      }
    } catch (err) {
      logger.warn(`watch ${file} failed: ${err}`);
    }
  }

  context.subscriptions.push(terminalManager, statusBar, wecomManager, wecomChannel, treeProvider, treeView);
  context.subscriptions.push({ dispose: () => watchers.forEach((w) => w.close()) });
}

export function deactivate(): void {
  logger.info('deactivate');
  terminalManager?.dispose();
  wecomChannel?.close();
  hookServer?.stop();
  disposeLogger();
}
