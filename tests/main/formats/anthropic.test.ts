import { describe, it, expect } from 'vitest';
import { anthropicAdapter } from '../../../src/main/formats/anthropic.js';

describe('anthropicAdapter.reassembleResponse', () => {
  it('解析非流式 JSON 响应', () => {
    const raw = JSON.stringify({
      id: 'msg_1',
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const r = anthropicAdapter.reassembleResponse(raw)!;
    expect(r.streamed).toBe(false);
    expect(r.model).toBe('claude-sonnet-4-20250514');
    expect(r.stop_reason).toBe('end_turn');
    expect(r.usage.input_tokens).toBe(10);
    expect(r.usage.output_tokens).toBe(5);
    expect(r.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('解析 SSE 流式响应', () => {
    const raw = [
      'data: {"type":"message_start","message":{"id":"m1","model":"claude-sonnet-4-20250514","usage":{"input_tokens":10,"output_tokens":0}}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
      'data: {"type":"message_stop"}',
    ].join('\n');
    const r = anthropicAdapter.reassembleResponse(raw)!;
    expect(r.streamed).toBe(true);
    expect(r.content[0]).toEqual({ type: 'text', text: 'hi' });
    expect(r.usage.output_tokens).toBe(2);
  });

  it('tool_use block 累积 input_json_delta', () => {
    const raw = [
      'data: {"type":"message_start","message":{"id":"m1","usage":{"input_tokens":10}}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Bash"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":\\"ls\\"}"}}',
      'data: {"type":"content_block_stop","index":0}',
    ].join('\n');
    const r = anthropicAdapter.reassembleResponse(raw)!;
    const tool = r.content[0] as any;
    expect(tool.type).toBe('tool_use');
    expect(tool.name).toBe('Bash');
    expect(tool.input).toEqual({ command: 'ls' });
  });

  it('SSE 错误事件', () => {
    const raw = 'data: {"type":"error","error":{"type":"rate_limit_error","message":"Too many requests"}}';
    const r = anthropicAdapter.reassembleResponse(raw)!;
    expect(r.error).toEqual({ type: 'rate_limit_error', message: 'Too many requests' });
  });
});

describe('anthropicAdapter.parseHttpError', () => {
  it('从 JSON 错误体提取', () => {
    const raw = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad model' } });
    const msg = anthropicAdapter.parseHttpError(400, raw);
    expect(msg).toContain('HTTP 400');
    expect(msg).toContain('invalid_request_error');
    expect(msg).toContain('bad model');
  });

  it('空 body 用 status', () => {
    const msg = anthropicAdapter.parseHttpError(500, '');
    expect(msg).toBe('HTTP 500');
  });
});

describe('anthropicAdapter.view', () => {
  it('渲染 system/messages/tools', () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      system: [{ text: 'You are helpful.' }],
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      ],
      tools: [{ name: 'Bash', description: 'run shell' }],
    };
    const v = anthropicAdapter.view(body);
    expect(v.system.length).toBe(1);
    expect(v.system[0].text).toBe('You are helpful.');
    expect(v.messages.length).toBe(2);
    expect(v.tools.length).toBe(1);
  });
});

describe('anthropicAdapter.parseRequest', () => {
  it('提取 user text', () => {
    const body = {
      messages: [{ role: 'user', content: '帮我查 auth' }],
    };
    const r = anthropicAdapter.parseRequest(body);
    expect(r.lastUserText).toBe('帮我查 auth');
  });

  it('提取 tool_result 失败标记', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'exit 1' }],
      }],
    };
    const r = anthropicAdapter.parseRequest(body);
    expect(r.toolResults?.[0].is_error).toBe(true);
  });
});
