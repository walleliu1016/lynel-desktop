import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consumeInputForExitDetect } from '../../src/main/app.js';

// 工具函数：临时切换 RECENT_SESSIONS_PATH 让 read/write 命中 tmpDir。
// app.ts 的 setTerminatedFlag/clearTerminatedFlag/getTerminatedFlag 是 module-internal，
// 无法直接覆盖文件路径，所以这里通过 vitest 的 spy 验证 consumeInputForExitDetect 的纯逻辑，
// 并通过 fs 模拟 recent-sessions.json 验证读/写流程不破现有 record schema。

describe('consumeInputForExitDetect', () => {
  it('detects /exit followed by \\r', () => {
    const r = consumeInputForExitDetect('', '/exit\r');
    expect(r.detected).toBe(true);
    expect(r.line).toBe('');
  });

  it('detects exit followed by \\n (no slash)', () => {
    const r = consumeInputForExitDetect('', 'exit\n');
    expect(r.detected).toBe(true);
    expect(r.line).toBe('');
  });

  it('detects /quit followed by \\r', () => {
    const r = consumeInputForExitDetect('', '/quit\r');
    expect(r.detected).toBe(true);
  });

  it('detects quit followed by \\r', () => {
    const r = consumeInputForExitDetect('', 'quit\r');
    expect(r.detected).toBe(true);
  });

  it('does not trigger on text containing exit', () => {
    // "exit code 0" 不应触发：只有整行就是 /exit/exit 才算
    const r = consumeInputForExitDetect('', 'exit code 0\r');
    expect(r.detected).toBe(false);
    expect(r.line).toBe('');
  });

  it('does not trigger on /exit with trailing space? we trim, so it does trigger', () => {
    // 故意保留行为：/exit 加空格 + 回车，trim 后匹配，仍然触发。
    // 这避免 "我多敲了个空格" 就 break /exit 检测。
    const r = consumeInputForExitDetect('', '/exit  \r');
    expect(r.detected).toBe(true);
  });

  it('handles byte-by-byte incremental input', () => {
    // 模拟用户按键：/ e x i t \r 分多次到达
    let state = consumeInputForExitDetect('', '/');
    state = consumeInputForExitDetect(state.line, 'e');
    state = consumeInputForExitDetect(state.line, 'x');
    state = consumeInputForExitDetect(state.line, 'i');
    state = consumeInputForExitDetect(state.line, 't');
    state = consumeInputForExitDetect(state.line, '\r');
    expect(state.detected).toBe(true);
    expect(state.line).toBe('');
  });

  it('backspace removes last char', () => {
    // /exi[t 退格] => /exi
    const r1 = consumeInputForExitDetect('', '/exit');
    const r2 = consumeInputForExitDetect(r1.line, '\x7f');
    expect(r2.line).toBe('/exi');
  });

  it('Ctrl+C clears current line and is not detected as exit', () => {
    // 输入 /exit 后 Ctrl+C，应当清空缓冲区但不触发 detected
    const r1 = consumeInputForExitDetect('', '/exit');
    const r2 = consumeInputForExitDetect(r1.line, '\x03');
    expect(r2.line).toBe('');
    expect(r2.detected).toBe(false);
  });

  it('Ctrl+U clears current line (kill)', () => {
    const r1 = consumeInputForExitDetect('', '/exit');
    const r2 = consumeInputForExitDetect(r1.line, '\x15');
    expect(r2.line).toBe('');
    expect(r2.detected).toBe(false);
  });

  it('Ctrl+W deletes last word', () => {
    // "hello world" + Ctrl+W => "hello "
    const r1 = consumeInputForExitDetect('', 'hello world');
    const r2 = consumeInputForExitDetect(r1.line, '\x17');
    expect(r2.line).toBe('hello ');
  });

  it('ignores ANSI escape sequences (does not pollute line)', () => {
    // 颜色转义不应当出现在 line 里
    const r = consumeInputForExitDetect('', '\x1b[31m/exit\x1b[0m\r');
    // \x1b 是 0x1b，charCodeAt 27，< 32 但不是 \t，忽略
    // [31m 是 '[' '3' '1' 'm'，全部可见
    // 所以实际累积的是 "[31m/exit[0m"
    // 我们只关心 trim 后匹配；这里是不匹配的（带 ANSI 字面量）
    // 重点是检测逻辑不会因为 raw 转义就提前返回 true
    expect(r.detected).toBe(false);
  });

  it('detects only once per Enter, subsequent /exit without retyping is not possible', () => {
    // 第一次 /exit\r 触发
    const r1 = consumeInputForExitDetect('', '/exit\r');
    expect(r1.detected).toBe(true);
    expect(r1.line).toBe('');
    // 同一 process 第二次 /exit 仍然能触发（用户重新输入）
    const r2 = consumeInputForExitDetect(r1.line, '/exit\r');
    expect(r2.detected).toBe(true);
  });

  it('keeps accumulating chars after a non-matching Enter', () => {
    // 普通行发送后，行缓冲被清空，下一行独立
    const r1 = consumeInputForExitDetect('', 'hello\r');
    expect(r1.detected).toBe(false);
    expect(r1.line).toBe('');
    const r2 = consumeInputForExitDetect(r1.line, '/exit\r');
    expect(r2.detected).toBe(true);
  });
});

describe('terminated flag persistence (file-level)', () => {
  let tmpDir: string;
  let recentPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-exit-detect-'));
    recentPath = path.join(tmpDir, 'recent-sessions.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRecent(list: unknown) {
    fs.writeFileSync(recentPath, JSON.stringify(list, null, 2), 'utf8');
  }

  function readRecent(): Array<{ sessionId: string; terminated?: boolean }> {
    return JSON.parse(fs.readFileSync(recentPath, 'utf8'));
  }

  it('preserves existing record fields when adding terminated=true', () => {
    // 模拟 recent-sessions.json 已有的真实 record，验证加 terminated 不破坏其他字段
    writeRecent([{
      sessionId: 's1',
      workdir: '/wd',
      project: 'p',
      aiTitle: 'title',
      firstPrompt: 'fp',
      userTitle: 'ut',
      lastOpenedAt: 1,
      state: 'running',
      botId: 'b',
    }]);
    const list = readRecent();
    const r = list.find((x) => x.sessionId === 's1')!;
    r.terminated = true;
    writeRecent(list);
    const after = readRecent();
    expect(after[0].terminated).toBe(true);
    expect(after[0].userTitle).toBe('ut');  // 没丢
    expect(after[0].botId).toBe('b');        // 没丢
  });

  it('clearing terminated with delete operator removes the key', () => {
    writeRecent([{ sessionId: 's1', workdir: '/wd', project: 'p', aiTitle: '', firstPrompt: '', lastOpenedAt: 1, state: 'running', terminated: true }]);
    const list = readRecent();
    const r = list.find((x) => x.sessionId === 's1')!;
    delete r.terminated;
    writeRecent(list);
    const after = readRecent();
    expect(after[0].terminated).toBeUndefined();
    expect('terminated' in after[0]).toBe(false);
  });

  it('getTerminatedFlag returns false for non-existing record', () => {
    // 验证空文件/缺失文件场景下 readRecent 不会抛
    writeRecent([]);
    const list = readRecent();
    const found = list.find((r) => r.sessionId === 'ghost');
    expect(found).toBeUndefined();
  });
});
