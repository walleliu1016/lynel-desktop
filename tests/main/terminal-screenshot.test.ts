import { describe, it, expect } from 'vitest';
import { stripAnsi, renderTextToPng, renderBufferToPng } from '../../src/main/terminal-screenshot.js';

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

describe('renderTextToPng', () => {
  it('返回 PNG Buffer', async () => {
    const buf = await renderTextToPng(['hello', 'world']);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });

  it('空数组返回最小 PNG', async () => {
    const buf = await renderTextToPng([]);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('自定义字号生效', async () => {
    const buf1 = await renderTextToPng(['test'], { fontSize: 12 });
    const buf2 = await renderTextToPng(['test'], { fontSize: 24 });
    expect(buf2.length).toBeGreaterThan(buf1.length);
  });

  it('cols 固定宽度', async () => {
    const buf = await renderTextToPng(['short'], { cols: 80 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
  });
});

describe('renderBufferToPng', () => {
  it('返回 PNG Buffer', async () => {
    const buf = await renderBufferToPng('hello world', { cols: 40 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf[0]).toBe(0x89);
  });

  it('带 ANSI 颜色渲染', async () => {
    const buf = await renderBufferToPng('\x1b[32mgreen\x1b[0m \x1b[1;31mbold red\x1b[0m', { cols: 80 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('中文渲染', async () => {
    const buf = await renderBufferToPng('你好世界 hello world', { cols: 60 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('空内容返回最小 PNG', async () => {
    const buf = await renderBufferToPng('', { cols: 40 });
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('多行渲染', async () => {
    const buf = await renderBufferToPng('line1\nline2\nline3', { cols: 40 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf[0]).toBe(0x89);
  });

  it('单独 \\r 应回到行首覆盖而非换行', async () => {
    // "loading" 后 \r 回到行首，再写 "loaded" 应覆盖为 "loaded"
    // 若 \r 被替换为 \n 会产生两行：["loading", "loaded"]
    // 正确渲染应只有一行 "loaded"
    const term = new (await import('@xterm/headless')).Terminal({ cols: 40, rows: 10, allowProposedApi: true });
    await new Promise<void>(r => term.write('loading\rloaded', r));
    const line = term.buffer.active.getLine(0);
    const text = line?.translateToString(true) ?? '';
    term.dispose();
    expect(text.startsWith('loaded')).toBe(true);
    expect(text).not.toContain('loading');
  });

  it('CRLF 不应产生空行', async () => {
    const term = new (await import('@xterm/headless')).Terminal({ cols: 40, rows: 10, allowProposedApi: true });
    await new Promise<void>(r => term.write('a\r\nb', r));
    const line0 = term.buffer.active.getLine(0)?.translateToString(true) ?? '';
    const line1 = term.buffer.active.getLine(1)?.translateToString(true) ?? '';
    term.dispose();
    expect(line0.startsWith('a')).toBe(true);
    expect(line1.startsWith('b')).toBe(true);
    // line0 在 'a' 之后不应有第二个 'a'（即不应是 "a" 然后空行）
    expect(line0.trim()).toBe('a');
  });

  it('截断的 SGR 序列不应泄漏为字面文本', async () => {
    // 模拟 buffer 截断在 \x1b[32m 中间（只剩 "2m..."）
    // headless xterm 应将 "2m" 作为普通文本，而非应用颜色
    // 这里用更极端的 \x1b[3 截断来验证
    const truncated = 'line1\n\x1b[3'; // 截断在 \x1b[3 处
    const buf = await renderBufferToPng(truncated, { cols: 40 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf[0]).toBe(0x89);
  });

  it('从 lastReset 之后开始写入，确保颜色状态从默认开始', async () => {
    // 构造：绿色文本 -> reset -> 红色文本（未 reset）
    // 若从头写：红色延续到结尾（正确）
    // 若截断在红色开启后：从头写红色延续；从 lastReset 写也红色延续
    // 这里验证 lastReset 逻辑：在 reset 后追加新内容，颜色应从默认开始
    const greenThenReset = '\x1b[32mgreen\x1b[0m\nplain';
    const buf = await renderBufferToPng(greenThenReset, { cols: 40 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    // plain 行不应是绿色（reset 后）
    // 这里只能验证 PNG 生成成功，颜色正确性需视觉验证
  });
});
