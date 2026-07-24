# 终端截图发送企业微信 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 企业微信 `/screenshot` 指令将任意会话终端最后 50 行渲染为 PNG 并发送

**Architecture:** 新增 `terminal-screenshot.ts` 纯函数模块（ANSI 清洗 + canvas 渲染），wecom-channel 新增 sentinel 指令路由和 `handleScreenshot` 方法（解析会话 → 取 buffer → 生成 PNG → uploadMedia → sendMediaMessage）

**Tech Stack:** TypeScript, @napi-rs/canvas, @wecom/aibot-node-sdk

## Global Constraints

- 纯文本白底黑字，不保留终端颜色
- 固定截取 buffer 最后 50 行
- 任意会话（含非前台）均可截图
- 失败时回复文本告知原因，不抛异常

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `package.json` | 修改 | 添加 `@napi-rs/canvas` 依赖 |
| `src/main/terminal-screenshot.ts` | 新建 | `stripAnsi()` + `renderTextToPng()` |
| `tests/main/terminal-screenshot.test.ts` | 新建 | 单元测试 |
| `src/main/channels/wecom-channel.ts` | 修改 | `/screenshot` 指令 + `handleScreenshot()` |

---

### Task 1: 安装 @napi-rs/canvas 依赖

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `@napi-rs/canvas` npm 依赖安装到位

- [ ] **Step 1: 添加依赖并安装**

在 `package.json` 的 `dependencies` 中添加：
```json
"@napi-rs/canvas": "^0.1.68"
```

```bash
cd "G:\work\lynel-desktop" && npm install
```

验证：
```bash
node -e "const c = require('@napi-rs/canvas'); console.log('ok', typeof c.createCanvas)"
```
Expected: `ok function`

---

### Task 2: 新建 terminal-screenshot.ts 模块

**Files:**
- Create: `src/main/terminal-screenshot.ts`

**Interfaces:**
- Produces: `stripAnsi(raw: string): string`, `renderTextToPng(lines: string[], fontSize?: number, padding?: number): Buffer`

- [ ] **Step 1: 编写 stripAnsi 函数**

```typescript
// src/main/terminal-screenshot.ts

/**
 * 清洗 ANSI/VT 控制码，保留可见文本。
 * 覆盖 SGR (CSI ... m)、光标控制 (CSI n A-G)、擦除 (CSI ... J/K)、
 * 状态请求 (CSI ... n/h/l) 及 OSC 序列 (\x1b]...)
 */
export function stripAnsi(raw: string): string {
  return raw
    // OSC sequences: \x1b]...ST (ST = \x1b\\ or BEL \x07)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // CSI sequences: \x1b[...m, \x1b[...J, etc. (parameter bytes 0x30-0x3F, intermediate 0x20-0x2F, final 0x40-0x7E)
    .replace(/\x1b\[[0-9;:<=>?]*[ -/]*[@-~]/g, '')
    // Two-character sequences (DCS, SOS, etc.)
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
    // Single-character escapes (\x1bD, \x1bM, etc.)
    .replace(/\x1b[^[\]PX^_0-9]?/g, '')
    // Carriage return (standalone, not followed by newline)
    .replace(/\r/g, '');
}
```

- [ ] **Step 2: 编写 renderTextToPng 函数**

```typescript
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

interface RenderOptions {
  fontSize?: number;
  padding?: number;
  lineHeight?: number;
}

export function renderTextToPng(
  lines: string[],
  opts: RenderOptions = {},
): Buffer {
  const fontSize = opts.fontSize ?? 14;
  const padding = opts.padding ?? 16;
  const lineHeight = opts.lineHeight ?? Math.round(fontSize * 1.5);

  if (lines.length === 0) {
    return createEmptyImage(padding);
  }

  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px "Consolas", "Courier New", monospace`;

  // 计算最长行像素宽度
  let maxTextWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxTextWidth) maxTextWidth = w;
  }

  const canvasWidth = Math.ceil(maxTextWidth) + padding * 2;
  const canvasHeight = lines.length * lineHeight + padding * 2;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  // 白底
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // 黑字
  ctx.fillStyle = '#000000';
  ctx.font = `${fontSize}px "Consolas", "Courier New", monospace`;
  ctx.textBaseline = 'top';

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], padding, padding + i * lineHeight);
  }

  return canvas.toBuffer('image/png');
}

function createEmptyImage(padding: number): Buffer {
  const canvas = createCanvas(padding * 2, padding * 2);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toBuffer('image/png');
}
```

---

### Task 3: 新建 terminal-screenshot 单元测试

**Files:**
- Create: `tests/main/terminal-screenshot.test.ts`

- [ ] **Step 1: 编写 stripAnsi 测试**

```typescript
import { describe, it, expect } from 'vitest';
import { stripAnsi, renderTextToPng } from '../../src/main/terminal-screenshot.js';

describe('stripAnsi', () => {
  it('去除 SGR 颜色码', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
  });

  it('去除光标控制序列', () => {
    expect(stripAnsi('\x1b[2J\x1b[1;1Hready')).toBe('ready');
  });

  it('保留纯文本', () => {
    const input = 'prompt> ls -la\r\nresult line 1\r\nresult line 2\r\n';
    const result = stripAnsi(input);
    expect(result).toContain('prompt> ls -la');
    expect(result).toContain('result line 1');
    expect(result).toContain('result line 2');
  });

  it('去除 OSC 标题序列', () => {
    expect(stripAnsi('\x1b]0;My Title\x07$ ')).toBe('$ ');
  });

  it('空字符串返回空', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('无 ANSI 码的纯文本原样返回', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
});
```

- [ ] **Step 2: 编写 renderTextToPng 测试**

```typescript
describe('renderTextToPng', () => {
  it('返回 PNG Buffer', () => {
    const buf = renderTextToPng(['hello', 'world']);
    expect(Buffer.isBuffer(buf)).toBe(true);
    // PNG magic bytes
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });

  it('空数组返回最小 PNG', () => {
    const buf = renderTextToPng([]);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('自定义字号生效', () => {
    const buf1 = renderTextToPng(['test'], { fontSize: 12 });
    const buf2 = renderTextToPng(['test'], { fontSize: 24 });
    // 大字号的图片应该更大
    expect(buf2.length).toBeGreaterThan(buf1.length);
  });
});
```

- [ ] **Step 3: 运行测试验证**

```bash
cd "G:\work\lynel-desktop" && npm run test:main -- --reporter=verbose 2>&1
```

Expected: terminal-screenshot.test.ts 全部通过

---

### Task 4: wecom-channel 新增 /screenshot 指令

**Files:**
- Modify: `src/main/channels/wecom-channel.ts`

**Interfaces:**
- Consumes: `stripAnsi`, `renderTextToPng` from `../terminal-screenshot.js`
- Produces: `/screenshot` 控制指令 + `handleScreenshot()` 方法

- [ ] **Step 1: 在文件顶部添加 import**

在现有 import 区域末尾添加：

```typescript
import { stripAnsi, renderTextToPng } from '../terminal-screenshot.js';
```

- [ ] **Step 2: 在 CONTROL_COMMANDS 中添加 /screenshot**

修改 `CONTROL_COMMANDS` 对象（约第 19-27 行）：

```typescript
const CONTROL_COMMANDS: Record<string, string> = {
  '/interrupt': '\x03',
  '/ctrl-c': '\x03',
  '/ctrl+c': '\x03',
  '/escape': '\x1b',
  '/esc': '\x1b',
  '/ctrl-d': '\x04',
  '/ctrl-z': '\x1a',
  '/screenshot': '__screenshot__', // sentinel: 截图而非写 PTY
};
```

- [ ] **Step 3: 在 handleControlCommand 开头添加 sentinel 判断**

修改 `handleControlCommand` 方法（约第 925 行），在函数体开头添加：

```typescript
private async handleControlCommand(
  chatId: string,
  body: any,
  command: string,
  controlChar: string,
): Promise<void> {
  // sentinel: 截图指令走独立流程
  if (controlChar === '__screenshot__') {
    await this.handleScreenshot(chatId, body);
    return;
  }

  // 以下为现有逻辑不变
  let sessionId: string | undefined;
  // ...
}
```

- [ ] **Step 4: 新增 handleScreenshot 方法**

在 `handleControlCommand` 方法之后（约第 974 行）添加：

```typescript
private async handleScreenshot(chatId: string, body: any): Promise<void> {
  // 1. 解析目标 session（复用现有路由逻辑）
  let sessionId: string | undefined;
  const quoteRouting = this.resolveSessionFromQuote(body);
  if (quoteRouting && !('error' in quoteRouting)) {
    sessionId = quoteRouting.id;
  }
  if (!sessionId && this.currentBotId) {
    for (const [sid, bid] of this.sessionBotMap) {
      if (bid === this.currentBotId) { sessionId = sid; break; }
    }
  }
  if (!sessionId) {
    const mapping = getMapping(chatId);
    if (mapping) sessionId = mapping.sessionId;
    else sessionId = this.chatIdToSession.get(chatId) || this.lastActiveSession.get(chatId);
  }

  if (!sessionId) {
    await this.sendWeComReply(chatId, '当前没有绑定会话，无法截图。');
    return;
  }

  const s = session.lookup(sessionId);
  if (!s) {
    await this.sendWeComReplyWithHeader(chatId, '会话不存在或已关闭。', sessionId);
    return;
  }

  // 2. 取 buffer
  const raw = session.getBuffer(sessionId);
  if (!raw) {
    await this.sendWeComReplyWithHeader(chatId, '终端暂无内容。', sessionId);
    return;
  }

  // 3. 清洗 ANSI + 取最后 50 行
  const clean = stripAnsi(raw);
  const allLines = clean.split('\n');
  const lines = allLines.slice(-50).map((l) => l.replace(/\s+$/, '') || ' ');

  // 4. 渲染 PNG
  let pngBuf: Buffer;
  try {
    pngBuf = renderTextToPng(lines);
  } catch (err: any) {
    logger.error('[wecom-channel] screenshot render failed:', err);
    await this.sendWeComReplyWithHeader(chatId, `截图渲染失败: ${err.message}`, sessionId);
    return;
  }

  // 5. 通过 wsClient 上传 + 发送
  const entry = this.resolveBotForChat(chatId);
  if (!entry?.wsClient) {
    await this.sendWeComReplyWithHeader(chatId, 'Bot 未连接。', sessionId);
    return;
  }

  try {
    const mediaId = await entry.wsClient.uploadMedia(pngBuf, { type: 'image' });
    await entry.wsClient.sendMediaMessage(chatId, 'image', mediaId);
    logger.info(`[wecom-channel] screenshot sent for session ${sessionId.slice(0, 8)} chatId=${chatId}`);
  } catch (err: any) {
    logger.error('[wecom-channel] screenshot upload/send failed:', err);
    await this.sendWeComReplyWithHeader(chatId, `截图发送失败: ${err.message}`, sessionId);
  }
}
```

- [ ] **Step 5: 新增 resolveBotForChat 辅助方法**

在 `resolveBotByChatId` 方法之后（约第 806 行）添加：

```typescript
private resolveBotForChat(chatId: string): BotConnectionState | undefined {
  let entry = this.currentBotId ? this.botPool.get(this.currentBotId) : undefined;
  if (!entry) entry = this.resolveBotByChatId(chatId);
  if (!entry) entry = this.resolveBot();
  return entry;
}
```

- [ ] **Step 6: 运行全量测试验证**

```bash
cd "G:\work\lynel-desktop" && npm run test:main 2>&1
```

Expected: 全部通过，包含 terminal-screenshot.test.ts 和 cloud-channel.test.ts

---

## Verification

1. `npm run test:main` 全绿
2. `cd src/renderer && npx vue-tsc --noEmit` 无类型错误
3. 启动 `node scripts/mock-cloud-server.cjs` + `npm run dev`，企业微信发送 `/screenshot` 验证图片接收
