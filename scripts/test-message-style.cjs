// 测试脚本：全场景格式检查
// 用法: node scripts/test-message-style.cjs

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function now() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function build(project, idx, sid, role, body) {
  const quotedBody = body ? '\n\n' + body.split('\n').map((l) => `> ${l}`).join('\n') : '';
  return `**${project}** · 会话#${idx} · \`${sid}\`\n\n${role} ${now()}\n**━━━━━━━━━━━━━━━━**${quotedBody}`;
}

const SAMPLES = [
  {
    label: '1. 用户消息',
    text: build('lynel-desktop', 3, 'a1b2c3d4', '👤 **用户**',
      '帮我看看 src/main/app.ts 里 createSessionInternal 的逻辑，有没有 race condition？'),
  },
  {
    label: '2. Agent 回复（多段落 + 行内代码 + 粗体）',
    text: build('lynel-desktop', 3, 'a1b2c3d4', '🤖 **Agent**',
      '看了 `createSessionInternal` 的实现，**当前没有 race condition**。\n\n关键流程是同步的：先生成 UUID → 注册到 SessionManager → 启动 APIProxy → spawn PTY。每个步骤都 await，不存在竞态。\n\n不过有一个建议：`session.register()` 和 `proxy.start()` 之间如果 proxy 启动失败，session 已经是 registered 状态但无法工作。'),
  },
  {
    label: '3. 思考过程',
    text: build('lynel-desktop', 3, 'a1b2c3d4', '💭 **思考**',
      '用户问的是 race condition，我需要检查 createSessionInternal 中各个异步操作之间是否存在未保护的间隙。重点关注 UUID 生成 → register → proxy.start → pty.spawn 这四个步骤的顺序和错误处理。'),
  },
  {
    label: '4. 工具调用',
    text: (() => {
      const h = `**lynel-desktop** · 会话#3 · \`a1b2c3d4\``;
      const role = `🔧 **Bash**`;
      const args = `\n\`\`\`bash\nrg "createSession" src/main/ --type ts -n\n\`\`\`\n> 📄 src/main/app.ts`;
      return `${h}\n\n${role} ${now()}\n**━━━━━━━━━━━━━━━━**${args}`;
    })(),
  },
  {
    label: '5. 工具完成',
    text: (() => {
      const h = `**lynel-desktop** · 会话#3 · \`a1b2c3d4\``;
      const role = `✅ **工具执行完成**`;
      const body = `(bash_001)`;
      const result = `\n\`\`\`text\nsrc/main/app.ts:142:  private async createSessionInternal(\nsrc/main/app.ts:200:    this.cloudChannel.syncSessions([sync]);\n\`\`\``;
      return `${h}\n\n${role} ${now()}\n**━━━━━━━━━━━━━━━━**\n\n> ${body}${result}`;
    })(),
  },
  {
    label: '6. 工具失败',
    text: build('lynel-desktop', 3, 'a1b2c3d4', '❌ **工具执行失败**',
      'command not found: rgx (bash_002)'),
  },
  {
    label: '7. 系统通知',
    text: build('lynel-desktop', 3, 'a1b2c3d4', '⚠️ **系统通知**',
      'API 代理启动失败 (ECONNREFUSED)，已降级为纯 PTY 模式。网关数据不可用。'),
  },
  {
    label: '8. 会话结束',
    text: build('lynel-desktop', 3, 'a1b2c3d4', '📌 **会话结束**', ''),
  },
  {
    label: '9. 权限请求（代码块也套 >）',
    text: build('lynel-desktop', 3, 'a1b2c3d4', '🔐 **权限请求：Bash**',
      '```\nrm -rf /tmp/cache\n```'),
  },
  {
    label: '10. Agent 提问（多问题）',
    text: build('lynel-desktop', 3, 'a1b2c3d4', '❓ **Agent 向你提问：**',
      '1. 是否确认删除？\n   1. 是\n   2. 否 (建议保留备份)\n\n2. 删除后是否清理相关缓存？\n   1. 是\n   2. 否\n   *多选，用逗号分隔*'),
  },
];

async function main() {
  const settingsPath = path.join(os.homedir(), 'AppData', 'Roaming', 'lynel-desktop', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const wecomCfg = (settings.channels && settings.channels.wecom) || {};
  if (!wecomCfg.botId || !wecomCfg.secret) {
    console.log('未找到 bot 配置');
    return;
  }
  const chatId = wecomCfg.chatId;
  console.log(`chatId=${chatId}`);

  const { WSClient } = require('@wecom/aibot-node-sdk');
  const wsClient = new WSClient({ botId: wecomCfg.botId, secret: wecomCfg.secret });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('connect timeout')), 15_000);
    wsClient.on('authenticated', () => { clearTimeout(timeout); console.log('connected'); resolve(); });
    wsClient.on('error', (err) => { clearTimeout(timeout); reject(err); });
    wsClient.connect();
  });

  for (const s of SAMPLES) {
    console.log(`sending: ${s.label}`);
    await wsClient.sendMessage(chatId, { msgtype: 'markdown', markdown: { content: s.text } });
  }

  console.log('done!');
  wsClient.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('failed:', err.message);
  process.exit(1);
});
