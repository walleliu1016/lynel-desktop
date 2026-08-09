import { describe, it, expect } from 'vitest';
import { openaiAdapter } from '../../../src/main/formats/openai.js';

describe('openaiAdapter.reassembleResponse', () => {
  it('重组 Chat Completions SSE 流（text delta + tool_calls delta + finish_reason）', () => {
    const raw = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-5","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-5","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-5","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"Bash","arguments":"{\\"command\\""}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"ls\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-5","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-5","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
      'data: [DONE]',
    ].join('\n');
    const r = openaiAdapter.reassembleResponse(raw)!;
    expect(r.streamed).toBe(true);
    expect(r.model).toBe('gpt-5');
    expect(r.stop_reason).toBe('tool_calls');
    expect(r.content[0]).toEqual({ type: 'text', text: 'Hello world' });
    expect(r.content[1]).toEqual({ type: 'tool_use', name: 'Bash', input: { command: 'ls' } });
    // usage 归一化
    expect(r.usage.input_tokens).toBe(10);
    expect(r.usage.output_tokens).toBe(5);
  });

  it('重组 Responses API SSE 流（output_text.delta + function_call + completed）', () => {
    const raw = [
      'data: {"type":"response.created","response":{"id":"resp_1","model":"codex-1","status":"in_progress"}}',
      'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"delta":"Hello"}',
      'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"delta":" world"}',
      'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"Bash","arguments":""}}',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":1,"delta":"{\\"command\\":\\"ls\\"}"}',
      'data: {"type":"response.completed","response":{"id":"resp_1","model":"codex-1","status":"completed","usage":{"input_tokens":20,"output_tokens":8,"total_tokens":28}}}',
      'data: [DONE]',
    ].join('\n');
    const r = openaiAdapter.reassembleResponse(raw)!;
    expect(r.streamed).toBe(true);
    expect(r.model).toBe('codex-1');
    expect(r.stop_reason).toBe('completed');
    expect(r.content[0]).toEqual({ type: 'text', text: 'Hello world' });
    expect(r.content[1]).toEqual({ type: 'tool_use', name: 'Bash', input: { command: 'ls' } });
    expect(r.usage.input_tokens).toBe(20);
    expect(r.usage.output_tokens).toBe(8);
  });

  it('重组 Responses API 非流式 JSON（output 数组）', () => {
    const raw = JSON.stringify({
      id: 'resp_1',
      object: 'response',
      model: 'codex-1',
      status: 'completed',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello', annotations: [] }] },
        { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'Bash', arguments: '{"command":"ls"}' },
      ],
      usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
    });
    const r = openaiAdapter.reassembleResponse(raw)!;
    expect(r.streamed).toBe(false);
    expect(r.model).toBe('codex-1');
    expect(r.stop_reason).toBe('completed');
    expect(r.content[0]).toEqual({ type: 'text', text: 'Hello' });
    expect(r.content[1]).toEqual({ type: 'tool_use', name: 'Bash', input: { command: 'ls' } });
    expect(r.usage.input_tokens).toBe(20);
    expect(r.usage.output_tokens).toBe(8);
  });

  it('重组 Chat Completions 非流式 JSON（choices）', () => {
    const raw = JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      model: 'gpt-5',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'Bash', arguments: '{"command":"ls"}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const r = openaiAdapter.reassembleResponse(raw)!;
    expect(r.streamed).toBe(false);
    expect(r.model).toBe('gpt-5');
    expect(r.stop_reason).toBe('tool_calls');
    expect(r.content[0]).toEqual({ type: 'text', text: 'Hello' });
    expect(r.content[1]).toEqual({ type: 'tool_use', name: 'Bash', input: { command: 'ls' } });
    expect(r.usage.input_tokens).toBe(10);
    expect(r.usage.output_tokens).toBe(5);
  });

  it('usage 归一化 cached_tokens → cache_read_input_tokens', () => {
    const raw = JSON.stringify({
      object: 'response',
      model: 'codex-1',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
      usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 60 } },
    });
    const r = openaiAdapter.reassembleResponse(raw)!;
    expect(r.usage.input_tokens).toBe(100);
    expect(r.usage.output_tokens).toBe(10);
    expect(r.usage.cache_read_input_tokens).toBe(60);
  });
});

describe('openaiAdapter.parseRequest', () => {
  it('提取 Chat Completions lastUserText + toolResults', () => {
    const body = {
      model: 'gpt-5',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: '列出文件' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Bash', arguments: '{"command":"ls"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'README.md\nsrc' },
      ],
    };
    const r = openaiAdapter.parseRequest(body);
    expect(r.model).toBe('gpt-5');
    expect(r.lastUserText).toBe('列出文件');
    expect(r.toolResults).toEqual([
      { tool_use_id: 'call_1', is_error: false, content_summary: 'README.md\nsrc' },
    ]);
  });

  it('提取 Responses API lastUserText + function_call_output toolResults', () => {
    const body = {
      model: 'codex-1',
      instructions: 'You are a coding agent',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: '修复这个 bug' }] },
        { type: 'function_call_output', call_id: 'call_1', output: 'exit code 1' },
      ],
    };
    const r = openaiAdapter.parseRequest(body);
    expect(r.model).toBe('codex-1');
    expect(r.lastUserText).toBe('修复这个 bug');
    expect(r.toolResults).toEqual([
      { tool_use_id: 'call_1', is_error: false, content_summary: 'exit code 1' },
    ]);
  });
});

describe('openaiAdapter.parseHttpError', () => {
  it('从 OpenAI error.message 提取', () => {
    const raw = JSON.stringify({
      error: { message: 'Rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit' },
    });
    const msg = openaiAdapter.parseHttpError(429, raw);
    expect(msg).toContain('HTTP 429');
    expect(msg).toContain('rate_limit_error');
    expect(msg).toContain('Rate limit exceeded');
  });

  it('空 body 用 status', () => {
    const msg = openaiAdapter.parseHttpError(500, '');
    expect(msg).toBe('HTTP 500');
  });
});

describe('openaiAdapter.view', () => {
  it('渲染 Chat Completions 的 system/messages/tools', () => {
    const body = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hi' },
        { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
      ],
      tools: [{ type: 'function', function: { name: 'Bash', description: 'run shell' } }],
    };
    const v = openaiAdapter.view(body);
    expect(v.system.length).toBe(1);
    expect(v.system[0].text).toBe('You are helpful.');
    expect(v.messages.length).toBe(2);
    expect(v.messages[1].type).toBe('tool_result');
    expect(v.tools.length).toBe(1);
    expect(v.tools[0].label).toBe('tool:Bash');
  });

  it('渲染 Responses API 的 input items', () => {
    const body = {
      instructions: 'You are a coding agent',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
      ],
    };
    const v = openaiAdapter.view(body);
    expect(v.system[0].text).toBe('You are a coding agent');
    expect(v.messages.length).toBe(2);
    expect(v.messages[1].type).toBe('tool_result');
  });
});

describe('openaiAdapter.costFromUsage', () => {
  it('codex 模型按 codex 价格计算', () => {
    const c = openaiAdapter.costFromUsage('codex-1', { input_tokens: 1000000, output_tokens: 100000 });
    expect(c.input).toBe(1000000);
    expect(c.output).toBe(100000);
    // input 1.25 + output 10（per 1M）
    expect(c.usd).toBeCloseTo(1.25 + 1.0, 5);
  });

  it('cacheRead 计入成本', () => {
    const c = openaiAdapter.costFromUsage('codex-1', {
      input_tokens: 1000000,
      output_tokens: 0,
      cache_read_input_tokens: 800000,
    });
    // uncached 200k * 1.25 + cached 800k * 0.125
    expect(c.usd).toBeCloseTo(0.25 + 0.1, 5);
    expect(c.cacheHitRate).toBeCloseTo(0.8, 5);
  });
});
