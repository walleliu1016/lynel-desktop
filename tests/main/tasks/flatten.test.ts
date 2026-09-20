// tests/main/tasks/flatten.test.ts
// 测试放在 tests/main/ 下是刻意的：这样才能同时 import 主进程的 parseStreamText
// 和渲染层的 flattenRunEvents，用真实 fixture 驱动整条链路（见 brief「Router's note」）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseStreamText } from '../../../src/main/tasks/streamParse.js';
import {
  flattenRunEvents, toolSummary, type StreamItem,
} from '../../../src/renderer/src/utils/tasks.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'stream-sample.jsonl');
const lines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);
const events = parseStreamText(lines.join('\n'));

function toolItems(items: StreamItem[]) {
  return items.filter((i) => i.kind === 'tool') as Extract<StreamItem, { kind: 'tool' }>[];
}

describe('toolSummary', () => {
  it('Bash → command', () => {
    expect(toolSummary('Bash', { command: 'ls -la' })).toBe('ls -la');
  });
  it('Read → file_path:offset-limit', () => {
    expect(toolSummary('Read', { file_path: 'a.ts', offset: 10, limit: 80 })).toBe('a.ts:10-89');
    expect(toolSummary('Read', { file_path: 'a.ts' })).toBe('a.ts');
  });
  it('Edit / Write → file_path', () => {
    expect(toolSummary('Edit', { file_path: 'a.ts' })).toBe('a.ts');
    expect(toolSummary('Write', { file_path: 'b.ts' })).toBe('b.ts');
  });
  it('Glob / Grep → pattern（Grep 附 path）', () => {
    expect(toolSummary('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
    expect(toolSummary('Grep', { pattern: 'foo', path: 'src' })).toBe('foo in src');
    expect(toolSummary('Grep', { pattern: 'foo' })).toBe('foo');
  });
  it('TodoWrite → N 项任务', () => {
    expect(toolSummary('TodoWrite', { todos: [{}, {}, {}] })).toBe('3 项任务');
  });
  it('Task → description', () => {
    expect(toolSummary('Task', { description: '查代码' })).toBe('查代码');
  });
  it('WebFetch → url，WebSearch → query', () => {
    expect(toolSummary('WebFetch', { url: 'https://x.dev' })).toBe('https://x.dev');
    expect(toolSummary('WebSearch', { query: 'foo' })).toBe('foo');
  });
  it('AskUserQuestion → 第一个问题', () => {
    expect(toolSummary('AskUserQuestion', { questions: [{ question: '选哪个？' }] })).toBe('选哪个？');
  });
  it('未知工具 → 第一个字符串字段；都没有 → 空串', () => {
    expect(toolSummary('Weird', { b: 1, a: 'first' })).toBe('first');
    expect(toolSummary('Weird', { n: 1 })).toBe('');
  });
  it('没有入参 → 空串', () => {
    expect(toolSummary('Bash', {})).toBe('');
  });
});

describe('flattenRunEvents 用真实 fixture', () => {
  const items = flattenRunEvents(events);

  // 注：brief 原文断言 items[0]==='init' / items[1]==='hook'，与已提交的 fixture 不符 ——
  // 真实 claude 2.1.114 的流开头两行就是 system/hook_started + system/hook_response
  // （计划 §8.4 与 fixture commit message 均已记录），init 在第 3 行。
  // 折叠必须按到达顺序展开，不能把 init 提到前面，故按 fixture 修正下标断言。
  it('产出 hook → init → thinking → text → tool 的顺序，且以 result 收尾', () => {
    expect(items[0].kind).toBe('hook');
    expect(items.map((i) => i.kind).indexOf('init')).toBeGreaterThan(0);
    expect(items.some((i) => i.kind === 'thinking')).toBe(true);
    expect(items.some((i) => i.kind === 'text')).toBe(true);
    expect(items.some((i) => i.kind === 'tool')).toBe(true);
    expect(items.at(-1)!.kind).toBe('result');
  });

  it('C1：同一 message.id 的多行合成一条消息（thinking 后紧跟 tool，不会被拆成两条独立消息）', () => {
    const kinds = items.map((i) => i.kind);
    const ti = kinds.indexOf('thinking');
    expect(kinds[ti + 1]).toBe('tool');
  });

  it('空 thinking block 不产出 item', () => {
    const thinking = items.filter((i) => i.kind === 'thinking') as Extract<StreamItem, { kind: 'thinking' }>[];
    expect(thinking.every((t) => t.text.length > 0)).toBe(true);
    expect(thinking).toHaveLength(1);
  });

  it('工具卡片带摘要与状态', () => {
    const t = toolItems(items)[0];
    expect(t.name).toBe('Bash');
    expect(t.summary).toBe('ls -la');
    expect(t.status).toBe('ok');
  });

  it('tool_use 与 tool_result 按 id 配对，输出落到同一个 item', () => {
    const t = toolItems(items)[0];
    expect(t.output).toBeTruthy();
    expect(t.output).toContain('total');
  });

  it('未配对的 tool_use 状态是 running', () => {
    const onlyToolUse = parseStreamText(JSON.stringify({
      type: 'assistant', message: { id: 'm', role: 'assistant', content: [{ type: 'tool_use', id: 'call_pending', name: 'Bash', input: { command: 'sleep' } }] },
    }));
    const out = toolItems(flattenRunEvents(onlyToolUse));
    expect(out[0].status).toBe('running');
    expect(out[0].output).toBeUndefined();
  });

  it('is_error 的 tool_result → status=error，但 pair 关系不断', () => {
    const seq = parseStreamText([
      JSON.stringify({ type: 'assistant', message: { id: 'm', role: 'assistant', content: [{ type: 'tool_use', id: 'call_bad', name: 'Bash', input: { command: 'x' } }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_bad', content: 'boom', is_error: true }] } }),
    ].join('\n'));
    const out = toolItems(flattenRunEvents(seq));
    expect(out[0].status).toBe('error');
    expect(out[0].output).toBe('boom');
  });

  it('Edit 的 delta 从 old_string / new_string 行数算出', () => {
    const seq = parseStreamText(JSON.stringify({
      type: 'assistant', message: { id: 'm', role: 'assistant', content: [{
        type: 'tool_use', id: 'call_e', name: 'Edit',
        input: { file_path: 'a.ts', old_string: 'x\ny', new_string: 'x\ny\nz' },
      }] },
    }));
    const out = toolItems(flattenRunEvents(seq));
    expect(out[0].delta).toEqual({ add: 3, del: 2 });
  });

  it('子代理（parent_tool_use_id 非 null）的 tool 标记 subagent=true', () => {
    const seq = parseStreamText(JSON.stringify({
      type: 'assistant', parent_tool_use_id: 'call_parent',
      message: { id: 'm', role: 'assistant', content: [{ type: 'tool_use', id: 'call_sub', name: 'Grep', input: { pattern: 'x' } }] },
    }));
    expect(toolItems(flattenRunEvents(seq))[0].subagent).toBe(true);
  });

  it('result 卡片带状态与成本', () => {
    const r = items.at(-1) as Extract<StreamItem, { kind: 'result' }>;
    expect(r.summary.subtype).toBe('success');
    expect(r.summary.totalCostUsd).toBeGreaterThan(0);
    expect(r.summary.usage.input_tokens).toBeGreaterThan(0);
  });

  it('stderr 事件产出 stderr item', () => {
    const seq = parseStreamText(JSON.stringify({ type: 'stderr', text: '警告' }));
    const out = flattenRunEvents(seq);
    expect(out).toEqual([{ kind: 'stderr', text: '警告' }]);
  });

  it('空输入返回空数组', () => {
    expect(flattenRunEvents([])).toEqual([]);
  });

  it('init 里的 MCP 失败被带出来', () => {
    const init = items.find((i) => i.kind === 'init') as Extract<StreamItem, { kind: 'init' }>;
    expect(init.failedMcpServers).toContain('tma1');
  });

  // EventEnvelope[]（{ seq, ts, event }）是生产环境唯一使用的输入形状：openRun 走
  // TasksRunEvents、tasks:runEvent 推送、Task 15 的 RunStreamView 都传信封。
  // 必须用真实 parser 产出的 DTO 包一层，否则 flattenRunEvents 里运行时嗅探
  // 'event' in e 的那支分支无人覆盖 —— 嗅探型代码正是会静默失效的那类。
  it('EventEnvelope[] 输入（生产形状）与裸 DTO[] 折叠出相同的 item 序列', () => {
    const enveloped = events.map((e, i) => ({ seq: i, ts: 0, event: e }));
    expect(flattenRunEvents(enveloped).map((i) => i.kind)).toEqual(
      flattenRunEvents(events).map((i) => i.kind),
    );
  });
});
