// 临时测试脚本：向企业微信 bot 发送一张测试图片
// 用法: node scripts/test-send-image.cjs

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function main() {
  // 1. 读取 bot 配置
  const settingsPath = path.join(os.homedir(), 'AppData', 'Roaming', 'lynel-desktop', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const wecomCfg = (settings.channels && settings.channels.wecom) || {};
  if (!wecomCfg.botId || !wecomCfg.secret) {
    console.log('未找到 bot 配置 (channels.wecom.botId/secret)');
    return;
  }
  console.log(`botId=${(wecomCfg.botId || '').slice(0, 8)}... chatId=${wecomCfg.chatId}`);

  // 2. 生成测试图片 (白底黑字)
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(400, 100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 400, 100);
  ctx.fillStyle = '#000000';
  ctx.font = '24px "Consolas", "Courier New", monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText('Hello from Lynel Desktop!', 16, 30);
  ctx.font = '14px "Consolas", "Courier New", monospace';
  ctx.fillStyle = '#666666';
  ctx.fillText(new Date().toLocaleString(), 16, 60);
  const pngBuf = canvas.toBuffer('image/png');
  console.log(`PNG size: ${pngBuf.length} bytes`);

  // 3. 加载 SDK，创建 WSClient，连接
  const { WSClient } = require('@wecom/aibot-node-sdk');
  const wsClient = new WSClient({
    botId: wecomCfg.botId,
    secret: wecomCfg.secret,
  });

  // 等待认证
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('connect timeout')), 15_000);
    wsClient.on('authenticated', () => {
      clearTimeout(timeout);
      console.log('ws authenticated');
      resolve();
    });
    wsClient.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    wsClient.connect();
  });

  // 4. 上传 + 发送
  console.log('uploading media...');
  const result = await wsClient.uploadMedia(pngBuf, { type: 'image', filename: 'test.png' });
  console.log(`media_id: ${result.media_id}`);

  console.log('sending image...');
  await wsClient.sendMediaMessage(wecomCfg.chatId, 'image', result.media_id);
  console.log('done!');

  wsClient.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('failed:', err.message);
  process.exit(1);
});
