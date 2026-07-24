// 验证截图渲染：构造模拟 Claude CLI TUI 输出，dump PNG 肉眼对比
// 用法: npm run test:main -- --run screenshot-dump

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderBufferToPng } from '../../src/main/terminal-screenshot.js';

// 模拟真实 Claude CLI 在 80x24 终端下的 TUI 输出
function buildClaudeTuiBuffer(cols: number, rows: number): string {
  const buf: string[] = [];
  const push = (s: string) => buf.push(s);

  // 清屏 + 回到原点
  push('\x1b[2J\x1b[H');

  // 顶部边框
  push('┌' + '─'.repeat(cols - 2) + '┐\r\n');
  // 标题行: │ <cyan>Claude Code</cyan>     │
  const title = 'Claude Code';
  const titlePad = Math.max(0, cols - 2 - title.length - 2);
  push('│ \x1b[1;36m' + title + '\x1b[0m' + ' '.repeat(titlePad) + ' │\r\n');
  push('├' + '─'.repeat(cols - 2) + '┤\r\n');

  // 内容区域
  const content1 = '> hello world';
  const content1Pad = Math.max(0, cols - 2 - content1.length - 2);
  push('│ ' + content1 + ' '.repeat(content1Pad) + ' │\r\n');
  push('│' + ' '.repeat(cols - 2) + '│\r\n');
  // │ ● Thinking... │  (● 1 + 空格 1 + Thinking... 12 = 14 可见字符)
  const content2Visible = 14;
  const content2Pad = Math.max(0, cols - 2 - content2Visible - 2);
  push('│ \x1b[32m●\x1b[0m Thinking...' + ' '.repeat(content2Pad) + ' │\r\n');

  // spinner 重绘 (定位到第 6 行: 1=border 2=title 3=sep 4=content1 5=空行 6=content2)
  push('\x1b[6;1H');
  push('│ \x1b[33m●\x1b[0m Thinking...' + ' '.repeat(content2Pad) + ' │\r\n');
  push('\x1b[6;1H');
  const content2bVisible = 8; // ● 1 + 空格 1 + Done! 5 + 1 = 8
  const content2bPad = Math.max(0, cols - 2 - content2bVisible - 2);
  push('│ \x1b[32m●\x1b[0m Done!' + ' '.repeat(content2bPad) + ' │\r\n');

  // 中间空行
  const fillRows = Math.max(0, rows - 4 - 6);
  for (let i = 0; i < fillRows; i++) {
    push('│' + ' '.repeat(cols - 2) + '│\r\n');
  }

  // 底部状态栏
  push('├' + '─'.repeat(cols - 2) + '┤\r\n');
  const status = 'ESC to interrupt';
  const statusPad = Math.max(0, cols - 2 - status.length - 2);
  push('│ \x1b[2m' + status + '\x1b[0m' + ' '.repeat(statusPad) + ' │\r\n');
  push('└' + '─'.repeat(cols - 2) + '┘');

  return buf.join('');
}

describe('screenshot dump', () => {
  it('dump rows=24 PNG (与 PTY 一致)', async () => {
    const cols = 80;
    const rows = 24;
    const raw = buildClaudeTuiBuffer(cols, rows);
    const png = await renderBufferToPng(raw, { cols, rows });
    const outPath = path.join(process.cwd(), 'scripts', 'dump-rows24.png');
    fs.writeFileSync(outPath, png);
    console.log(`rows=24 -> ${outPath} (${png.length} bytes)`);
    expect(Buffer.isBuffer(png)).toBe(true);
  });

  it('dump rows=100 PNG (旧行为)', async () => {
    const cols = 80;
    const raw = buildClaudeTuiBuffer(cols, 24);
    const png = await renderBufferToPng(raw, { cols, rows: 100 });
    const outPath = path.join(process.cwd(), 'scripts', 'dump-rows100.png');
    fs.writeFileSync(outPath, png);
    console.log(`rows=100 -> ${outPath} (${png.length} bytes)`);
    expect(Buffer.isBuffer(png)).toBe(true);
  });

  it('dump default (不传 rows)', async () => {
    const cols = 80;
    const raw = buildClaudeTuiBuffer(cols, 24);
    const png = await renderBufferToPng(raw, { cols });
    const outPath = path.join(process.cwd(), 'scripts', 'dump-default.png');
    fs.writeFileSync(outPath, png);
    console.log(`default -> ${outPath} (${png.length} bytes)`);
    expect(Buffer.isBuffer(png)).toBe(true);
  });

  it('dump 真实尺寸 cols=120 rows=30', async () => {
    const cols = 120;
    const rows = 30;
    const raw = buildClaudeTuiBuffer(cols, rows);
    const png = await renderBufferToPng(raw, { cols, rows });
    const outPath = path.join(process.cwd(), 'scripts', 'dump-120x30.png');
    fs.writeFileSync(outPath, png);
    console.log(`120x30 -> ${outPath} (${png.length} bytes)`);
    expect(Buffer.isBuffer(png)).toBe(true);
  });
});
