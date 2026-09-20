// tests/main/tasks/streamParse.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseStreamLine, parseStreamText, normalizeToolResultContent, pickUsage,
  isResumeMissing, USAGE_KEYS, type NormalizedEvent,
} from '../../../src/main/tasks/streamParse.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'stream-sample.jsonl');
const fixtureLines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);

describe('parseStreamLine 基本健壮性', () => {
  it('空行 / 纯空白 → null', () => {
    expect(parseStreamLine('')).toBeNull();
    expect(parseStreamLine('   ')).toBeNull();
    expect(parseStreamLine('\r')).toBeNull();
  });

  it('非法 JSON → null（不抛异常）', () => {
    expect(parseStreamLine('not json at all')).toBeNull();
    expect(parseStreamLine('{ broken')).toBeNull();
  });

  it('合法 JSON 但缺 type → null', () => {
    expect(parseStreamLine('{"a":1}')).toBeNull();
    expect(parseStreamLine('[]')).toBeNull();
    expect(parseStreamLine('null')).toBeNull();
  });

  it('未知 type → null（未知事件不再往下传）', () => {
    expect(parseStreamLine('{"type":"tool_progress","tool_name":"Bash"}')).toBeNull();
    expect(parseStreamLine('{"type":"control_request"}')).toBeNull();
  });

  it('带 \\r\\n 的行走同样的路径', () => {
    const ev = parseStreamLine('{"type":"stderr","text":"boom"}\r');
    expect(ev?.type).toBe('stderr');
    expect(ev?.text).toBe('boom');
  });

  it('超长行不炸', () => {
    const big = 'x'.repeat(2_000_000);
    const ev = parseStreamLine(JSON.stringify({ type: 'stderr', text: big }));
    expect(ev?.text?.length).toBe(2_000_000);
  });
});

describe('system 事件（C4：hook_started / hook_response 不能被丢）', () => {
  it('init 抽出 cwd/model/tools 数量/mcp 失败列表', () => {
    const ev = parseStreamLine(fixtureLines[2])!;
    expect(ev.type).toBe('system');
    expect(ev.subtype).toBe('init');
    expect(ev.init?.model).toBeTruthy();
    expect(ev.init?.toolCount).toBeGreaterThan(0);
    expect(ev.init?.cwd).toBeTruthy();
  });

  it('init 里 mcp_servers 的 failed 项被抽出来', () => {
    const ev = parseStreamLine(fixtureLines[2])!;
    expect(ev.init?.failedMcpServers).toContain('tma1');
  });

  it('hook_started 归一化为 hook 事件且带名字', () => {
    const ev = parseStreamLine(fixtureLines[0])!;
    expect(ev.type).toBe('system');
    expect(ev.subtype).toBe('hook_started');
    expect(ev.hook?.name).toContain('SessionStart');
  });

  it('hook_response 带成功标记', () => {
    const ev = parseStreamLine(fixtureLines[1])!;
    expect(ev.subtype).toBe('hook_response');
    expect(ev.hook?.ok).toBe(true);
  });

  it('hook_response 的 outcome 非 success 时 ok=false', () => {
    const raw = JSON.stringify({
      type: 'system', subtype: 'hook_response', hook_name: 'PostToolUse:Bash',
      hook_event: 'PostToolUse', exit_code: 2, outcome: 'error',
    });
    expect(parseStreamLine(raw)!.hook?.ok).toBe(false);
  });
});

describe('assistant 事件（C1：一个 block 一行，messageId 必须透出）', () => {
  it('thinking block 归一化，空 thinking 被过滤成空 blocks', () => {
    const ev = parseStreamLine(fixtureLines[3])!;
    expect(ev.type).toBe('assistant');
    expect(ev.messageId).toBeTruthy();
    expect(ev.blocks?.[0].type).toBe('thinking');
  });

  it('空的 thinking block（thinking 为空串）不产出 block', () => {
    const ev = parseStreamLine(fixtureLines[6])!;
    expect(ev.type).toBe('assistant');
    expect(ev.blocks).toEqual([]);
  });

  it('tool_use block 保留原始 id 与 name 与 input（C2：id 不带 toolu_ 前缀）', () => {
    const ev = parseStreamLine(fixtureLines[4])!;
    const block = ev.blocks!.find((b) => b.type === 'tool_use')!;
    expect(block.type).toBe('tool_use');
    if (block.type !== 'tool_use') throw new Error('unreachable');
    expect(block.id).not.toMatch(/^toolu_/);
    expect(block.id).toContain('call_');
    expect(block.name).toBe('Bash');
    expect(block.input.command).toBe('ls -la');
  });

  it('同一 message.id 跨多行的行都带同一个 messageId', () => {
    const a = parseStreamLine(fixtureLines[3])!;
    const b = parseStreamLine(fixtureLines[4])!;
    expect(a.messageId).toBe(b.messageId);
    const c = parseStreamLine(fixtureLines[6])!;
    expect(c.messageId).not.toBe(a.messageId);
  });

  it('content 是字符串（legacy）时当成单个 text block', () => {
    const raw = JSON.stringify({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: 'hi' } });
    expect(parseStreamLine(raw)!.blocks).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('parent_tool_use_id 透出（子代理）', () => {
    const raw = JSON.stringify({
      type: 'assistant', parent_tool_use_id: 'call_x',
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'sub' }] },
    });
    expect(parseStreamLine(raw)!.parentToolUseId).toBe('call_x');
    const top = parseStreamLine(fixtureLines[3])!;
    expect(top.parentToolUseId).toBeNull();
  });
});

describe('user 事件与 tool_result（C3：content 多态）', () => {
  it('字符串 content 直接沿用', () => {
    const ev = parseStreamLine(fixtureLines[5])!;
    expect(ev.type).toBe('user');
    expect(ev.toolResult?.isError).toBe(false);
    expect(ev.toolResult?.content).toContain('total');
    expect(ev.toolResult?.toolUseId).toContain('call_');
  });

  it('数组 content 拼接 text block', () => {
    const raw = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }] },
    });
    expect(parseStreamLine(raw)!.toolResult?.content).toBe('a\nb');
  });

  it('content 为 null 时归一化成空串，不抛', () => {
    const raw = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: null }] },
    });
    expect(parseStreamLine(raw)!.toolResult?.content).toBe('');
  });

  it('image block 降级为占位文字', () => {
    const raw = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'image', source: {} }, { type: 'text', text: 'ok' }] }] },
    });
    expect(parseStreamLine(raw)!.toolResult?.content).toBe('[图片]\nok');
  });

  it('is_error 缺失按 false；is_error 为 true 时透出', () => {
    const base = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'e' }] } };
    expect(parseStreamLine(JSON.stringify(base))!.toolResult?.isError).toBe(false);
    const err = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'e', is_error: true }] } };
    expect(parseStreamLine(JSON.stringify(err))!.toolResult?.isError).toBe(true);
  });

  it('纯文本 user 消息（没有 tool_result）不产出 toolResult', () => {
    const raw = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } });
    const ev = parseStreamLine(raw)!;
    expect(ev.type).toBe('user');
    expect(ev.toolResult).toBeUndefined();
  });
});

describe('result 事件（C5：usage 必须白名单取值）', () => {
  it('抽出终态字段', () => {
    const ev = parseStreamLine(fixtureLines[8])!;
    expect(ev.type).toBe('result');
    expect(ev.result?.subtype).toBe('success');
    expect(ev.result?.isError).toBe(false);
    expect(ev.result?.numTurns).toBeGreaterThan(0);
    expect(ev.result?.totalCostUsd).toBeGreaterThan(0);
    expect(ev.result?.stopReason).toBe('end_turn');
  });

  it('usage 只保留白名单里的数值字段，嵌套对象与字符串被丢掉', () => {
    const ev = parseStreamLine(fixtureLines[8])!;
    const usage = ev.result!.usage;
    expect(Object.keys(usage).every((k) => (USAGE_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(Object.values(usage).every((v) => typeof v === 'number')).toBe(true);
    expect(usage.input_tokens).toBeGreaterThan(0);
    expect('server_tool_use' in usage).toBe(false);
    expect('service_tier' in usage).toBe(false);
    expect('cache_creation' in usage).toBe(false);
  });

  it('pickUsage 对完全非法的入参返回空对象', () => {
    expect(pickUsage(null)).toEqual({});
    expect(pickUsage('x')).toEqual({});
    expect(pickUsage({ input_tokens: 'oops' })).toEqual({});
  });

  it('result_text 是双重编码的 JSON 字符串时解一层', () => {
    const raw = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify('解出来') });
    expect(parseStreamLine(raw)!.result?.resultText).toBe('解出来');
  });

  it('permission_denials 抽出工具名列表', () => {
    const raw = JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: 'ok',
      permission_denials: [{ tool_name: 'Bash', tool_use_id: 'x' }],
    });
    expect(parseStreamLine(raw)!.result?.permissionDenials).toEqual(['Bash']);
  });
});

describe('parseStreamText：逐行切分', () => {
  it('整份 fixture 解析出 9 条事件，无效行不产出', () => {
    const withNoise = [...fixtureLines.slice(0, 3), '', 'garbage', ...fixtureLines.slice(3)].join('\n');
    const events = parseStreamText(withNoise);
    expect(events).toHaveLength(9);
  });

  it('分块喂入与整块喂入结果一致（模拟 stdout chunk 切分）', () => {
    const whole = parseStreamText(fixtureLines.join('\n'));
    expect(whole).toHaveLength(9);
    expect(whole[3].messageId).toBe(parseStreamText(fixtureLines[3]).at(0)!.messageId);
  });
});

describe('isResumeMissing（R2 实测）', () => {
  it('只有 error_during_execution + num_turns=0 + 无 assistant → true', () => {
    const events = parseStreamText(JSON.stringify({
      type: 'result', subtype: 'error_during_execution', is_error: true,
      num_turns: 0, total_cost_usd: 0, result: '', session_id: 'x',
    }));
    expect(isResumeMissing(events)).toBe(true);
  });

  it('出现任意 assistant 事件 → false（真的跑过内容，不是 resume 失败）', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 0 }),
    ].join('\n');
    expect(isResumeMissing(parseStreamText(lines))).toBe(false);
  });

  it('num_turns 非 0 → false', () => {
    const events = parseStreamText(JSON.stringify({
      type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 3,
    }));
    expect(isResumeMissing(events)).toBe(false);
  });

  it('成功 result → false', () => {
    const events = parseStreamText(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1 }));
    expect(isResumeMissing(events)).toBe(false);
  });

  it('没有任何 result 事件 → false（调用方按进程失败处理）', () => {
    expect(isResumeMissing([])).toBe(false);
    expect(isResumeMissing(parseStreamText(JSON.stringify({ type: 'stderr', text: 'x' })))).toBe(false);
  });
});

describe('normalizeToolResultContent', () => {
  it('三态 + 未知类型全部安全处理', () => {
    expect(normalizeToolResultContent('abc')).toBe('abc');
    expect(normalizeToolResultContent(null)).toBe('');
    expect(normalizeToolResultContent(undefined)).toBe('');
    expect(normalizeToolResultContent(42)).toBe('42');
    expect(normalizeToolResultContent([])).toBe('');
    expect(normalizeToolResultContent([{ type: 'text', text: 'a' }, { type: 'image' }])).toBe('a\n[图片]');
  });

  it('交错 block 保持原始顺序（回归守卫）', () => {
    expect(
      normalizeToolResultContent([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]),
    ).toBe('a\n[图片]\nb');
  });
});
