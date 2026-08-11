import { describe, it, expect } from 'vitest';
import { OpenAiSessionAdapter } from '../../../src/main/adapter/openaiAdapter.js';

// DeepSeek Responses API 流式无 [DONE]，以 response.completed 结尾（官方语义）。
// 这里用与 deepseek-v4-flash 一致的 event 序列验证 adapter 产出的 envelope。

describe('OpenAiSessionAdapter Responses API (codex)', () => {
  it('用户提示请求：发出 user text envelope', () => {
    const adapter = new OpenAiSessionAdapter('codex');
    const body = {
      model: 'deepseek-v4-flash',
      input: [{ type: 'message', role: 'user', content: '帮我查 auth 逻辑' }],
      stream: true,
    };
    const envs = adapter.handleRequest(body);
    expect(envs.length).toBe(1);
    expect(envs[0].role).toBe('user');
    expect(envs[0].ev).toEqual({ t: 'text', text: '帮我查 auth 逻辑' });
  });

  it('工具回填轮（input 以 function_call_output 结尾）：只发 tool-call-end，不发 user 文本', () => {
    const adapter = new OpenAiSessionAdapter('codex');
    const body = {
      model: 'deepseek-v4-flash',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        { type: 'function_call', id: 'fc_1', name: 'bash', arguments: '{"command":"ls"}' },
        { type: 'function_call_output', call_id: 'fc_1', output: 'file1' },
      ],
    };
    const envs = adapter.handleRequest(body);
    expect(envs.length).toBe(1);
    expect(envs[0].ev.t).toBe('tool-call-end');
    if (envs[0].ev.t === 'tool-call-end') {
      expect(envs[0].ev.call).toBe('fc_1');
      expect(envs[0].ev.result).toBe('file1');
    }
  });

  it('流式文本：created→delta×2→completed 产出 turn-start + text + turn-end', () => {
    const adapter = new OpenAiSessionAdapter('codex');
    const all: any[] = [];
    all.push(...adapter.handleSseEvent({ type: 'response.created', response: {} }));
    all.push(...adapter.handleSseEvent({ type: 'response.output_text.delta', delta: '你好' }));
    all.push(...adapter.handleSseEvent({ type: 'response.output_text.delta', delta: '，世界' }));
    all.push(...adapter.handleSseEvent({ type: 'response.completed', response: { status: 'completed' } }));

    const types = all.map((e) => e.ev.t);
    expect(types).toEqual(['turn-start', 'text', 'turn-end']);
    expect(all[1].ev).toEqual({ t: 'text', text: '你好，世界' });
    expect(all[2].ev).toEqual({ t: 'turn-end', status: 'completed' });
  });

  it('流式工具调用：function_call 累积 args 后补全 tool-call-start', () => {
    const adapter = new OpenAiSessionAdapter('codex');
    const all: any[] = [];
    all.push(...adapter.handleSseEvent({ type: 'response.created', response: {} }));
    all.push(...adapter.handleSseEvent({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', id: 'fc_9', name: 'bash' },
    }));
    all.push(...adapter.handleSseEvent({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"com' }));
    all.push(...adapter.handleSseEvent({ type: 'response.function_call_arguments.delta', output_index: 0, delta: 'mand":"ls"}' }));
    all.push(...adapter.handleSseEvent({ type: 'response.completed', response: { status: 'completed' } }));

    const types = all.map((e) => e.ev.t);
    expect(types).toEqual(['turn-start', 'tool-call-start', 'turn-end']);
    const tool = all[1].ev as any;
    expect(tool.call).toBe('fc_9');
    expect(tool.name).toBe('bash');
    expect(tool.args).toEqual({ command: 'ls' });
  });
});

describe('OpenAiSessionAdapter Chat Completions (opencode/omp)', () => {
  it('用户提示请求（messages）：发出 user text envelope', () => {
    const adapter = new OpenAiSessionAdapter('omp');
    const body = {
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    };
    const envs = adapter.handleRequest(body);
    expect(envs[0].role).toBe('user');
    expect(envs[0].ev).toEqual({ t: 'text', text: 'hi' });
  });

  it('流式文本：delta 累积，finish_reason 触发 flush + turn-end', () => {
    const adapter = new OpenAiSessionAdapter('omp');
    const all: any[] = [];
    // chat.completion.chunk 不带 .type，靠 .choices 识别
    all.push(...adapter.handleSseEvent({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '前端' } }] }));
    all.push(...adapter.handleSseEvent({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '代码' } }] }));
    all.push(...adapter.handleSseEvent({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));

    const types = all.map((e) => e.ev.t);
    expect(types).toEqual(['turn-start', 'text', 'turn-end']);
    expect(all[1].ev).toEqual({ t: 'text', text: '前端代码' });
  });

  it('工具调用：tool_calls delta 累积 name/arguments 后补全 tool-call-start', () => {
    const adapter = new OpenAiSessionAdapter('opencode');
    const all: any[] = [];
    all.push(...adapter.handleSseEvent({
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read', arguments: '{"path":"' } }] } }],
    }));
    all.push(...adapter.handleSseEvent({
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'a.ts"}' } }] } }],
    }));
    all.push(...adapter.handleSseEvent({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));

    const types = all.map((e) => e.ev.t);
    expect(types).toEqual(['turn-start', 'tool-call-start', 'turn-end']);
    const tool = all[1].ev as any;
    expect(tool.name).toBe('read');
    expect(tool.args).toEqual({ path: 'a.ts' });
  });
});

describe('OpenAiSessionAdapter 错误路径', () => {
  it('handleHttpError：service 错误 + turn-end(failed)', () => {
    const adapter = new OpenAiSessionAdapter('codex');
    const envs = adapter.handleHttpError('HTTP 400: bad request');
    const types = envs.map((e) => e.ev.t);
    expect(types).toEqual(['turn-start', 'service', 'turn-end']);
    expect(envs[1].ev).toEqual({ t: 'service', text: '**API Error**: HTTP 400: bad request' });
  });

  it('handleNetworkError：network 错误 + turn-end(failed)', () => {
    const adapter = new OpenAiSessionAdapter('codex');
    const envs = adapter.handleNetworkError('ECONNRESET');
    const types = envs.map((e) => e.ev.t);
    expect(types).toEqual(['turn-start', 'service', 'turn-end']);
    expect(envs[1].ev).toEqual({ t: 'service', text: '**Network Error**: ECONNRESET' });
  });
});
