/**
 * 企业微信消息推送测试脚本
 *
 * 用法（推荐用环境变量注入凭证，避免写死到文件）：
 *   WECOM_MODE=bot WECOM_CHAT_ID=xxx WECOM_BOT_ID=xxx WECOM_SECRET=xxx node scripts/test-wecom-push.mjs
 *   WECOM_MODE=agent WECOM_CHAT_ID=xxx WECOM_CORP_ID=xxx WECOM_CORP_SECRET=xxx WECOM_AGENT_ID=xxx WECOM_TOKEN=xxx WECOM_ENCODING_AES_KEY=xxx node scripts/test-wecom-push.mjs
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(__filename);
// 当前脚本位于 ease-ui/scripts/，插件位于同级的 wecom-openclaw-plugin
const pluginDir = path.resolve(scriptDir, '../../wecom-openclaw-plugin');

const pluginModule = await import('@wecom/wecom-openclaw-plugin');
const { setWeComWebSocket } = await import(pathToFileURL(path.join(pluginDir, 'dist/src/state-manager.js')).href);
const { WSClient } = await import(pathToFileURL(path.join(pluginDir, 'node_modules/@wecom/aibot-node-sdk/dist/index.esm.js')).href);

function loadWecomPlugin() {
  let captured = null;
  const mockApi = {
    runtime: {
      log: (...args) => console.log('[plugin-runtime]', ...args),
      error: (...args) => console.error('[plugin-runtime]', ...args),
      config: { readConfigFile: async () => ({}), writeConfigFile: async () => {} },
      channel: {
        text: { chunkMarkdownText: (text) => [text] },
        routing: { resolveAgentRoute: () => ({}) },
        session: { resolveStorePath: () => '', recordInboundSession: async () => {} },
        reply: { dispatchReplyWithBufferedBlockDispatcher: async () => {} },
      },
    },
    registerChannel: ({ plugin }) => {
      captured = plugin;
    },
    registerTool: () => {},
    registerHttpRoute: () => {},
    on: () => {},
  };
  pluginModule.default.register(mockApi);
  return captured;
}

const wecomPlugin = loadWecomPlugin();

const mode = process.env.WECOM_MODE || 'agent';
const chatId = process.env.WECOM_CHAT_ID;

function buildConfig() {
  if (mode === 'bot') {
    return {
      channels: {
        wecom: {
          enabled: true,
          botId: process.env.WECOM_BOT_ID,
          secret: process.env.WECOM_SECRET,
        },
      },
    };
  }
  return {
    channels: {
      wecom: {
        enabled: true,
        agent: {
          corpId: process.env.WECOM_CORP_ID,
          corpSecret: process.env.WECOM_CORP_SECRET,
          agentId: Number(process.env.WECOM_AGENT_ID || 0),
          token: process.env.WECOM_TOKEN,
          encodingAESKey: process.env.WECOM_ENCODING_AES_KEY,
        },
      },
    },
  };
}

function validate() {
  if (!chatId) {
    throw new Error('缺少 WECOM_CHAT_ID');
  }
  if (mode === 'bot') {
    if (!process.env.WECOM_BOT_ID || !process.env.WECOM_SECRET) {
      throw new Error('Bot 模式需要 WECOM_BOT_ID 和 WECOM_SECRET');
    }
  } else {
    const required = ['WECOM_CORP_ID', 'WECOM_CORP_SECRET', 'WECOM_AGENT_ID', 'WECOM_TOKEN', 'WECOM_ENCODING_AES_KEY'];
    for (const key of required) {
      if (!process.env[key]) {
        throw new Error(`Agent 模式需要 ${key}`);
      }
    }
  }
}

function connectBotWebsocket() {
  return new Promise((resolve, reject) => {
    const wsClient = new WSClient({
      botId: process.env.WECOM_BOT_ID,
      secret: process.env.WECOM_SECRET,
      wsUrl: process.env.WECOM_WS_URL || 'wss://openws.work.weixin.qq.com',
      heartbeatInterval: 30000,
      maxReconnectAttempts: 3,
      maxAuthFailureAttempts: 2,
      logger: {
        debug: (...args) => console.log('[ws]', ...args),
        info: (...args) => console.log('[ws]', ...args),
        warn: (...args) => console.warn('[ws]', ...args),
        error: (...args) => console.error('[ws]', ...args),
      },
    });

    const timer = setTimeout(() => {
      wsClient.disconnect();
      reject(new Error('WebSocket 认证超时（15s），请检查 botId/secret 和网络'));
    }, 15000);

    wsClient.on('authenticated', () => {
      clearTimeout(timer);
      setWeComWebSocket('default', wsClient);
      resolve(wsClient);
    });

    wsClient.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    wsClient.connect();
  });
}

async function main() {
  validate();
  const cfg = buildConfig();
  const sendText = wecomPlugin?.outbound?.sendText;
  if (typeof sendText !== 'function') {
    throw new Error('插件 outbound.sendText 不可用');
  }

  const text = `[测试] Lynel Desktop 企业微信推送测试 @ ${new Date().toLocaleString()}`;
  console.log('mode:', mode);
  console.log('chatId:', chatId);
  console.log('text:', text);

  let wsClient;
  if (mode === 'bot') {
    console.log('正在连接企业微信 WebSocket...');
    wsClient = await connectBotWebsocket();
    console.log('WebSocket 认证成功');
  }

  try {
    const result = await sendText({
      to: chatId,
      text,
      accountId: 'default',
      cfg,
    });

    console.log('发送结果:', JSON.stringify(result, null, 2));
  } finally {
    if (wsClient) {
      wsClient.disconnect();
    }
  }
}

main().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
