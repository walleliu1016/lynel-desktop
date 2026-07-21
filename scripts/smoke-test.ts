// Smoke test: 用 node:test 验证核心模块
// 运行: npx tsx scripts/smoke-test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Protocol
test('protocol/usage - makeUsage strips undefined', async () => {
  const { makeUsage } = await import('../src/main/protocol/usage.ts');
  const u = makeUsage({ input_tokens: 10, output_tokens: 5 });
  assert.equal(u.input_tokens, 10);
  assert.equal(u.output_tokens, 5);
  assert.equal(u.cache_creation_input_tokens, undefined);
  assert.equal('cache_creation_input_tokens' in u, false);
});

test('protocol/events - canCarryUsage classification', async () => {
  const { canCarryUsage } = await import('../src/main/protocol/events.ts');
  assert.equal(canCarryUsage({ t: 'turn-start' }), false);
  assert.equal(canCarryUsage({ t: 'turn-end', status: 'completed' }), false);
  assert.equal(canCarryUsage({ t: 'text', text: 'x' }), true);
  assert.equal(canCarryUsage({ t: 'service', text: 'x' }), true);
  assert.equal(canCarryUsage({ t: 'tool-call-end', call: 'c' }), true);
  assert.equal(canCarryUsage({ t: 'tool-call-end', call: 'c', is_error: true, error: 'x' }), true);
});

test('protocol/envelope - createEnvelope with seq and agent', async () => {
  const { createEnvelope, stripEnvelope } = await import('../src/main/protocol/envelope.ts');
  const env = createEnvelope('user', { t: 'text', text: 'hi' }, { seq: 1, agent: 'claude' });
  assert.equal(env.role, 'user');
  assert.equal(env.seq, 1);
  assert.equal(env.agent, 'claude');
  assert.ok(env.id);
  const s = stripEnvelope(env);
  assert.equal(s.role, 'user');
  assert.equal(s.seq, 1);
});

test('protocol/envelope - tool-call-end with is_error', async () => {
  const { createEnvelope } = await import('../src/main/protocol/envelope.ts');
  const env = createEnvelope('agent', { t: 'tool-call-end', call: 'tu_1', is_error: true, error: 'fail' }, { seq: 2, turn: 't1' });
  assert.equal(env.ev.t, 'tool-call-end');
  if (env.ev.t === 'tool-call-end') {
    assert.equal(env.ev.is_error, true);
    assert.equal(env.ev.error, 'fail');
  }
});

// Adapter - turn boundaries
test('adapter/sessionAdapter - turn boundary triggers turn-end then turn-start', async () => {
  const { SessionAdapter } = await import('../src/main/adapter/sessionAdapter.ts');
  const a = new SessionAdapter();
  a.state.turn.currentTurnId = 't-old';
  const envs = a.handleRequest({ messages: [{ role: 'user', content: 'hi' }] });
  // turn-end + user text = 2（turn-start 在 message_start 触发）
  assert.equal(envs.length, 2);
  assert.deepEqual(envs[0].ev, { t: 'turn-end', status: 'completed' });
  assert.equal(envs[1].role, 'user');
  assert.equal(envs[1].ev.t, 'text');
});

test('adapter/sessionAdapter - tool_result-only: only tool-call-end', async () => {
  const { SessionAdapter } = await import('../src/main/adapter/sessionAdapter.ts');
  const a = new SessionAdapter();
  a.state.turn.currentTurnId = 't1';
  const envs = a.handleRequest({
    messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }] }],
  });
  assert.equal(envs.length, 1);
  assert.equal(envs[0].ev.t, 'tool-call-end');
});

test('adapter/sessionAdapter - tool_result.is_error propagates', async () => {
  const { SessionAdapter } = await import('../src/main/adapter/sessionAdapter.ts');
  const a = new SessionAdapter();
  a.state.turn.currentTurnId = 't1';
  const envs = a.handleRequest({
    messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'exit 1' }] }],
  });
  const ev = envs[0].ev;
  if (ev.t === 'tool-call-end') {
    assert.equal(ev.is_error, true);
    assert.ok(ev.error?.includes('exit 1'));
  }
});

test('adapter/sessionAdapter - simple text flow', async () => {
  const { SessionAdapter } = await import('../src/main/adapter/sessionAdapter.ts');
  const a = new SessionAdapter();
  const events = [
    { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
  ];
  const envs = events.flatMap(e => a.handleSseEvent(e));
  assert.equal(envs.map(e => e.ev.t).join(','), 'turn-start,text');
  assert.equal(envs[1].ev.t, 'text');
  if (envs[1].ev.t === 'text') assert.equal(envs[1].ev.text, 'hi');
  assert.equal(envs[1].usage?.input_tokens, 10);
  assert.equal(envs[1].usage?.output_tokens, 5);
});

test('adapter/sessionAdapter - SSE error emits service + turn-end failed', async () => {
  const { SessionAdapter } = await import('../src/main/adapter/sessionAdapter.ts');
  const a = new SessionAdapter();
  a.state.turn.currentTurnId = 't1';
  const envs = a.handleSseEvent({ type: 'error', error: { type: 'rate_limit', message: 'Too many' } });
  assert.equal(envs[0].ev.t, 'service');
  assert.equal(envs[1].ev.t, 'turn-end');
  if (envs[1].ev.t === 'turn-end') assert.equal(envs[1].ev.status, 'failed');
});

test('adapter/sessionAdapter - tool_use accumulates args then emits', async () => {
  const { SessionAdapter } = await import('../src/main/adapter/sessionAdapter.ts');
  const a = new SessionAdapter();
  const events = [
    { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'Bash' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' } },
    { type: 'content_block_stop', index: 0 },
  ];
  const envs = events.flatMap(e => a.handleSseEvent(e));
  assert.equal(envs[1].ev.t, 'tool-call-start');
  if (envs[1].ev.t === 'tool-call-start') {
    assert.equal(envs[1].ev.call, 'tu_1');
    assert.equal(envs[1].ev.name, 'Bash');
    assert.deepEqual(envs[1].ev.args, { command: 'ls' });
  }
});

test('adapter/sessionAdapter - HTTP error', async () => {
  const { SessionAdapter } = await import('../src/main/adapter/sessionAdapter.ts');
  const a = new SessionAdapter();
  a.state.turn.currentTurnId = 't1';
  const envs = a.handleHttpError('HTTP 429');
  assert.equal(envs[0].ev.t, 'service');
  assert.equal(envs[1].ev.t, 'turn-end');
});

test('adapter/sessionAdapter - network error', async () => {
  const { SessionAdapter } = await import('../src/main/adapter/sessionAdapter.ts');
  const a = new SessionAdapter();
  const envs = a.handleNetworkError('ECONNREFUSED');
  assert.equal(envs[0].ev.t, 'service');
  assert.equal(envs[1].ev.t, 'turn-end');
});

test('adapter/toolLifecycle - args accumulate', async () => {
  const { ToolTracker } = await import('../src/main/adapter/toolLifecycle.ts');
  const t = new ToolTracker();
  const envs: any[] = [];
  t.setEnvelopeBuffer(envs);
  envs.push({ ev: { t: 'tool-call-start', call: 'tu_1', args: {} } });
  t.onToolUseStart(0, 'tu_1', 'Bash', 0);
  t.onInputJsonDelta(0, '{"command":');
  t.onInputJsonDelta(0, '"ls"}');
  const args = t.onToolUseStop(0);
  assert.deepEqual(args, { command: 'ls' });
  assert.deepEqual(envs[0].ev.args, { command: 'ls' });
});

test('adapter/toolLifecycle - tool_result active cleanup', async () => {
  const { ToolTracker } = await import('../src/main/adapter/toolLifecycle.ts');
  const t = new ToolTracker();
  t.onToolUseStart(0, 'tu_1', 'Bash', 0);
  t.onToolUseStop(0);
  assert.equal(t.isActive('tu_1'), true);
  const out = t.onToolResult('tu_1', false);
  assert.equal(out.call, 'tu_1');
  assert.equal(out.is_error, undefined);
  assert.equal(t.isActive('tu_1'), false);
});

test('adapter/toolLifecycle - tool_result with is_error', async () => {
  const { ToolTracker } = await import('../src/main/adapter/toolLifecycle.ts');
  const t = new ToolTracker();
  t.onToolUseStart(0, 'tu_1', 'Bash', 0);
  t.onToolUseStop(0);
  const out = t.onToolResult('tu_1', true, 'exit 1');
  assert.equal(out.is_error, true);
  assert.equal(out.error, 'exit 1');
});

test('adapter/turnStateMachine - isTurnBoundary', async () => {
  const { isTurnBoundary } = await import('../src/main/adapter/turnStateMachine.ts');
  assert.equal(isTurnBoundary({ messages: [{ role: 'user', content: 'hi' }] }), true);
  assert.equal(isTurnBoundary({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x' }] }] }), false);
  assert.equal(isTurnBoundary({ messages: [{ role: 'assistant', content: 'x' }] }), false);
});

test('adapter/requestParser - extractUserText', async () => {
  const { extractUserText } = await import('../src/main/adapter/requestParser.ts');
  assert.equal(extractUserText({ role: 'user', content: 'hello' }), 'hello');
  assert.equal(extractUserText({ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'a\nb');
  assert.equal(extractUserText({ role: 'assistant' }), null);
});

test('adapter/requestParser - extractToolResults with is_error', async () => {
  const { extractToolResults } = await import('../src/main/adapter/requestParser.ts');
  const r = extractToolResults({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'fail' }] });
  assert.equal(r.length, 1);
  assert.equal(r[0].is_error, true);
  assert.ok(r[0].content_summary.includes('fail'));
});

test('cost/priceTable - priceFor', async () => {
  const { priceFor } = await import('../src/main/cost/priceTable.ts');
  assert.equal(priceFor('claude-sonnet-4-20250514').input, 3);
  assert.equal(priceFor('claude-opus-4-5-20251101').input, 5);
  assert.equal(priceFor('claude-opus-4-1').input, 15);
  assert.equal(priceFor('claude-haiku-4-5-20251001').input, 1);
});

test('cost/priceTable - costFromUsage USD', async () => {
  const { costFromUsage } = await import('../src/main/cost/priceTable.ts');
  const c = costFromUsage('claude-sonnet-4-20250514', { input_tokens: 1_000_000, output_tokens: 100_000 });
  assert.ok(Math.abs(c.usd - 4.5) < 1e-5);
});

test('cost/priceTable - cache hit rate', async () => {
  const { costFromUsage } = await import('../src/main/cost/priceTable.ts');
  const c = costFromUsage('claude-sonnet-4-20250514', { input_tokens: 500, cache_read_input_tokens: 500 });
  assert.equal(c.cacheHitRate, 0.5);
});

test('cost/priceTable - estimateTokens', async () => {
  const { estimateTokens } = await import('../src/main/cost/priceTable.ts');
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('hello world') > 0);
  assert.ok(estimateTokens('你好世界') > 0);
});

test('cost/usage - summarizeUsage', async () => {
  const { summarizeUsage } = await import('../src/main/cost/usage.ts');
  const records = [
    { session: 's1', seq: 1, ts: 1000, model: 'claude-sonnet-4-20250514', usage: { input_tokens: 1000, output_tokens: 100 } },
    { session: 's1', seq: 2, ts: 2000, model: 'claude-sonnet-4-20250514', usage: { input_tokens: 1000, output_tokens: 100 } },
    { session: 's2', seq: 1, ts: 3000, model: 'claude-sonnet-4-20250514', usage: { input_tokens: 1000, output_tokens: 100 } },
  ];
  const s = summarizeUsage(records);
  assert.equal(s.requestCount, 3);
  assert.equal(s.sessionCount, 2);
  assert.equal(s.totals.input, 3000);
});

test('cost/usage - unmeasured count', async () => {
  const { summarizeUsage } = await import('../src/main/cost/usage.ts');
  const records = [
    { session: 's1', seq: 1, ts: 1000, model: 'x' },
    { session: 's1', seq: 2, ts: 2000, model: 'claude-sonnet-4-20250514', usage: { input_tokens: 100, output_tokens: 10 } },
  ];
  const s = summarizeUsage(records);
  assert.equal(s.unmeasured, 1);
  assert.equal(s.requestCount, 1);
});

test('trace/timing - latencyMs', async () => {
  const { latencyMs } = await import('../src/main/trace/timing.ts');
  assert.equal(latencyMs({ startedAt: 100, finishedAt: 350 }), 250);
  assert.equal(latencyMs({ startedAt: 100 }), null);
  assert.equal(latencyMs({ ts: 100, finishedAt: 350 }), 250);
});

test('trace/timing - requestTiming', async () => {
  const { requestTiming } = await import('../src/main/trace/timing.ts');
  const t = requestTiming({ startedAt: 1000, firstByteAt: 2000, finishedAt: 3000, input_tokens: 100, output_tokens: 50 });
  assert.equal(t?.totalMs, 2000);
  assert.equal(t?.ttftMs, 1000);
  assert.equal(t?.genMs, 1000);
  assert.ok(Math.abs((t?.inTps ?? 0) - 100) < 1e-5);
  assert.ok(Math.abs((t?.outTps ?? 0) - 50) < 1e-5);
});

test('trace/timing - recordModel preference', async () => {
  const { recordModel } = await import('../src/main/trace/timing.ts');
  assert.equal(recordModel({ model: 'sonnet-4' }, { model: 'haiku' }), 'sonnet-4');
  assert.equal(recordModel({}, { model: 'haiku' }), 'haiku');
  assert.equal(recordModel({}, null), null);
});

test('formats/anthropic - parseRequest user text', async () => {
  const { anthropicAdapter } = await import('../src/main/formats/anthropic.ts');
  const r = anthropicAdapter.parseRequest({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.lastUserText, 'hi');
});

test('formats/anthropic - parseRequest tool_result is_error', async () => {
  const { anthropicAdapter } = await import('../src/main/formats/anthropic.ts');
  const r = anthropicAdapter.parseRequest({
    messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu', is_error: true, content: 'x' }] }],
  });
  assert.equal(r.toolResults?.[0].is_error, true);
});

test('formats/anthropic - reassemble non-streaming JSON', async () => {
  const { anthropicAdapter } = await import('../src/main/formats/anthropic.ts');
  const raw = JSON.stringify({
    id: 'm1', model: 'claude-sonnet-4-20250514', stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'hello' }],
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  const r = anthropicAdapter.reassembleResponse(raw);
  assert.equal(r?.streamed, false);
  assert.equal(r?.model, 'claude-sonnet-4-20250514');
  assert.equal(r?.usage.input_tokens, 10);
  assert.equal(r?.content[0].type, 'text');
});

test('formats/anthropic - reassemble SSE stream', async () => {
  const { anthropicAdapter } = await import('../src/main/formats/anthropic.ts');
  const raw = [
    'data: {"type":"message_start","message":{"id":"m","usage":{"input_tokens":10}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
    'data: {"type":"content_block_stop","index":0}',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
  ].join('\n');
  const r = anthropicAdapter.reassembleResponse(raw);
  assert.equal(r?.streamed, true);
  assert.equal((r?.content[0] as any).text, 'hi');
  assert.equal(r?.usage.output_tokens, 2);
});

test('formats/anthropic - reassemble tool_use accumulates input_json_delta', async () => {
  const { anthropicAdapter } = await import('../src/main/formats/anthropic.ts');
  const raw = [
    'data: {"type":"message_start","message":{"id":"m","usage":{"input_tokens":10}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu","name":"Bash"}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":\\"ls\\"}"}}',
    'data: {"type":"content_block_stop","index":0}',
  ].join('\n');
  const r = anthropicAdapter.reassembleResponse(raw);
  const tool = r?.content[0] as any;
  assert.equal(tool.type, 'tool_use');
  assert.deepEqual(tool.input, { command: 'ls' });
});

test('formats/anthropic - parseHttpError', async () => {
  const { anthropicAdapter } = await import('../src/main/formats/anthropic.ts');
  const raw = JSON.stringify({ type: 'error', error: { type: 'rate_limit', message: 'too many' } });
  const m = anthropicAdapter.parseHttpError(429, raw);
  assert.ok(m.includes('429'));
  assert.ok(m.includes('rate_limit'));
  assert.equal(anthropicAdapter.parseHttpError(500, ''), 'HTTP 500');
});

test('formats/anthropic - view', async () => {
  const { anthropicAdapter } = await import('../src/main/formats/anthropic.ts');
  const v = anthropicAdapter.view({
    model: 'claude-sonnet-4',
    system: [{ text: 'You are helpful' }],
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ],
    tools: [{ name: 'Bash', description: 'shell' }],
  });
  assert.equal(v.system.length, 1);
  assert.equal(v.messages.length, 2);
  assert.equal(v.tools.length, 1);
});

test('archive/rawArchive - write and read', async () => {
  const { writeRawExchange, readRawExchange, listRawExchanges } = await import('../src/main/archive/rawArchive.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-'));
  writeRawExchange({
    sessionId: 's1', sessionDir: tmp, seq: 1, ts: 1000,
    startedAt: 1050, firstByteAt: 2000, finishedAt: 2100,
    model: 'claude-sonnet-4-20250514', format: 'anthropic',
    request: { method: 'POST', url: '/v1/messages', headers: { 'x-api-key': 'sk-ant-1234567890abcdef' }, body: {} },
    response: { status: 200, headers: {}, raw: 'data: x' },
    trace: { totalMs: 1050, ttftMs: 950, genMs: 100, inTps: 10, outTps: 5 },
    reassembled: null,
    cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, totalInput: 0, cacheHitRate: 0, usd: 0 },
    error: false,
  });
  const r = readRawExchange(tmp, 1);
  assert.equal(r.seq, 1);
  assert.equal(r.error, false);
  assert.ok(r.request.headers['x-api-key'].includes('REDACTED'));
  assert.deepEqual(listRawExchanges(tmp), [1]);
  fs.rmSync(tmp, { recursive: true });
});

test('archive/rawArchive - error flag', async () => {
  const { writeRawExchange, readRawExchange } = await import('../src/main/archive/rawArchive.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-err-'));
  writeRawExchange({
    sessionId: 's1', sessionDir: tmp, seq: 1, ts: 0, startedAt: 0, firstByteAt: null, finishedAt: 100,
    model: null, format: 'anthropic',
    request: { method: 'POST', url: '/v1/messages', headers: {}, body: {} },
    response: { status: 500, headers: {}, raw: '' },
    trace: { totalMs: 0, ttftMs: 0, genMs: 0, inTps: null, outTps: null },
    reassembled: null, cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, totalInput: 0, cacheHitRate: 0, usd: 0 },
    error: true,
  });
  const r = readRawExchange(tmp, 1);
  assert.equal(r.error, true);
  fs.rmSync(tmp, { recursive: true });
});

test('archive/happyJsonl - read/write envelopes', async () => {
  const { HappyJsonlWriter } = await import('../src/main/archive/happyJsonl.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-'));
  const w = new HappyJsonlWriter(tmp);
  w.open();
  w.append({ id: 'c1', time: 100, role: 'user', seq: 1, ev: { t: 'text', text: 'hi' } });
  w.close();
  const all = HappyJsonlWriter.readAll(tmp);
  assert.equal(all.length, 1);
  assert.equal(all[0].role, 'user');
  fs.rmSync(tmp, { recursive: true });
});

test('channels/registry - dispatch envelope', async () => {
  const { ChannelDispatcher } = await import('../src/main/channels/registry.ts');
  const d = new ChannelDispatcher();
  let received: any = null;
  d.register({
    id: 't', name: 'T', isEnabled: () => true,
    send: (e: any) => { received = e; },
  });
  const env = { id: 'c1', time: 1, role: 'user' as const, seq: 1, ev: { t: 'text' as const, text: 'hi' } };
  await d.dispatch(env);
  assert.equal(received.id, 'c1');
});

test('channels/registry - dispatch hook', async () => {
  const { ChannelDispatcher } = await import('../src/main/channels/registry.ts');
  const d = new ChannelDispatcher();
  let received: any = null;
  d.registerHook({
    id: 'h', name: 'H', isEnabled: () => true,
    sendHook: (e: any) => { received = e; },
  });
  const h = { kind: 'UserPromptSubmit' as const, sessionId: 's1', workDir: '/wd', payload: {} };
  await d.dispatchHook(h);
  assert.equal(received.kind, 'UserPromptSubmit');
});

test('channels/registry - disabled skipped', async () => {
  const { ChannelDispatcher } = await import('../src/main/channels/registry.ts');
  const d = new ChannelDispatcher();
  let called = 0;
  d.register({
    id: 'd', name: 'D', isEnabled: () => false,
    send: () => { called++; },
  });
  await d.dispatch({ id: 'c', time: 0, role: 'user', seq: 1, ev: { t: 'text', text: 'x' } });
  assert.equal(called, 0);
});
