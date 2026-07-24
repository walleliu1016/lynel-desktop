import { describe, it, expect } from 'vitest';
import { SessionAdapter, type SseEvent } from '../../../src/main/adapter/sessionAdapter.js';
import type { ApiRequest } from '../../../src/main/adapter/turnStateMachine.js';
import { cleanUserText } from '../../../src/main/adapter/requestParser.js';

describe('SessionAdapter turn boundaries', () => {
  it('user 纯文本请求：关闭上一 turn + user text', () => {
    const adapter = new SessionAdapter();
    adapter.state.turn.currentTurnId = 't-old'; // 模拟已有 turn

    const req: ApiRequest = {
      messages: [{ role: 'user', content: '帮我查 auth' }],
    };
    const envs = adapter.handleRequest(req);
    // turn-end + user text = 2（turn-start 在 message_start 触发）
    expect(envs.map((e) => e.ev.t)).toEqual(['turn-end', 'text']);
    expect(envs[0].ev).toEqual({ t: 'turn-end', status: 'completed' });
    expect(envs[1].role).toBe('user');
  });

  it('tool_result-only 请求：只发 tool-call-end，不关 turn', () => {
    const adapter = new SessionAdapter();
    adapter.state.turn.currentTurnId = 't1';

    const req: ApiRequest = {
      messages: [{
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'result' }],
      }],
    };
    const envs = adapter.handleRequest(req);
    expect(envs.length).toBe(1);
    expect(envs[0].ev.t).toBe('tool-call-end');
    expect(envs[0].ev.call).toBe('toolu_1');
  });

  it('tool_result 失败：tool-call-end 带 is_error', () => {
    const adapter = new SessionAdapter();
    adapter.state.turn.currentTurnId = 't1';

    const req: ApiRequest = {
      messages: [{
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'exit 1' }],
      }],
    };
    const envs = adapter.handleRequest(req);
    const ev = envs[0].ev;
    expect(ev.t).toBe('tool-call-end');
    if (ev.t === 'tool-call-end') {
      expect(ev.is_error).toBe(true);
      expect(ev.error).toContain('exit 1');
    }
  });
});

describe('cleanUserText: 过滤 Claude Code TUI 注入内容', () => {
  it('纯用户输入原样返回', () => {
    expect(cleanUserText('帮我查 auth')).toBe('帮我查 auth')
  })

  it('去掉 <system-reminder> 块', () => {
    const raw = '<system-reminder>这是自动注入的上下文</system-reminder>\n帮我看 auth.ts'
    expect(cleanUserText(raw)).toBe('帮我看 auth.ts')
  })

  it('去掉多个 <system-reminder> 块', () => {
    const raw = [
      '<system-reminder>first</system-reminder>',
      '实际输入',
      '<system-reminder>second</system-reminder>',
    ].join('\n')
    expect(cleanUserText(raw)).toBe('实际输入')
  })

  it('去掉 [AUTO MODE: ...] 顶栏横幅', () => {
    expect(cleanUserText('[AUTO MODE: enabled]\n帮我跑测试')).toBe('帮我跑测试')
  })

  it('去掉 [SUGGESTION MODE: ...] 顶栏横幅', () => {
    expect(cleanUserText('[SUGGESTION MODE: 3 options]\n查一下 memory')).toBe('查一下 memory')
  })

  it('只剩 system-reminder 时返回 null', () => {
    expect(cleanUserText('<system-reminder>only</system-reminder>')).toBeNull()
  })

  it('只剩 MODE 横幅时返回 null', () => {
    expect(cleanUserText('[AUTO MODE: enabled]')).toBeNull()
  })

  it('空字符串返回 null', () => {
    expect(cleanUserText('')).toBeNull()
    expect(cleanUserText('   \n  ')).toBeNull()
  })

  it('同时含 system-reminder + MODE 横幅 + 真实输入', () => {
    const raw = '<system-reminder>cwd=/work</system-reminder>\n[EXECUTE MODE: yes]\n帮我看 test'
    expect(cleanUserText(raw)).toBe('帮我看 test')
  })
})

describe('SessionAdapter: 过滤后的 user 消息', () => {
  it('只剩 system-reminder 的 user 消息不产生 user text envelope', () => {
    const adapter = new SessionAdapter()
    adapter.state.turn.currentTurnId = 't-old'

    const req: ApiRequest = {
      messages: [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' },
          { type: 'text', text: '<system-reminder>auto</system-reminder>' },
        ],
      }],
    }
    const envs = adapter.handleRequest(req)
    // tool-result 产生 tool-call-end，user text 被过滤后只剩 reminder → 不产生 user text
    const userText = envs.find((e) => e.ev.t === 'text' && e.role === 'user')
    expect(userText).toBeUndefined()
  })

  it('system-reminder + 真实输入：只保留真实输入', () => {
    const adapter = new SessionAdapter()
    const req: ApiRequest = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '<system-reminder>auto-context</system-reminder>' },
          { type: 'text', text: '帮我看 test' },
        ],
      }],
    }
    const envs = adapter.handleRequest(req)
    const userText = envs.find((e) => e.ev.t === 'text' && e.role === 'user')
    expect(userText).toBeDefined()
    if (userText && userText.ev.t === 'text') {
      expect(userText.ev.text).toBe('帮我看 test')
    }
  })
})

describe('SessionAdapter SSE flow', () => {
  it('简单 text 响应：turn-start + text', () => {
    const adapter = new SessionAdapter();
    const events: SseEvent[] = [
      { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    ];
    const envs = events.flatMap((e) => adapter.handleSseEvent(e));
    expect(envs.map((e) => e.ev.t)).toEqual(['turn-start', 'text']);
    expect(envs[1].ev).toEqual({ t: 'text', text: 'hello' });
    expect(envs[1].usage?.input_tokens).toBe(10);
    expect(envs[1].usage?.output_tokens).toBe(5);
  });

  it('tool_use 响应：tool-call-start 立即 emit，args 累积后补全', () => {
    const adapter = new SessionAdapter();
    const events: SseEvent[] = [
      { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 20 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"ls' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"}' } },
      { type: 'content_block_stop', index: 0 },
    ];
    const envs = events.flatMap((e) => adapter.handleSseEvent(e));
    expect(envs.map((e) => e.ev.t)).toEqual(['turn-start', 'tool-call-start']);
    expect(envs[1].ev.t).toBe('tool-call-start');
    if (envs[1].ev.t === 'tool-call-start') {
      // 初始时 args 可能是空或传入的 input，后续由 ToolTracker 补全
      expect(envs[1].ev.call).toBe('toolu_1');
      expect(envs[1].ev.name).toBe('Bash');
    }
  });

  it('SSE error 事件：service + turn-end failed', () => {
    const adapter = new SessionAdapter();
    adapter.state.turn.currentTurnId = 't1';

    const envs = adapter.handleSseEvent({
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Too many requests' },
    });
    expect(envs.map((e) => e.ev.t)).toEqual(['service', 'turn-end']);
    expect(envs[0].ev).toEqual({ t: 'service', text: '**API Error**: rate_limit_error - Too many requests' });
    expect(envs[1].ev).toEqual({ t: 'turn-end', status: 'failed' });
  });

  it('HTTP 错误：handleHttpError 发 service + turn-end failed', () => {
    const adapter = new SessionAdapter();
    adapter.state.turn.currentTurnId = 't1';
    const envs = adapter.handleHttpError('HTTP 429 Too many requests');
    expect(envs[0].ev).toEqual({ t: 'service', text: '**API Error**: HTTP 429 Too many requests' });
    expect(envs[1].ev).toEqual({ t: 'turn-end', status: 'failed' });
  });

  it('网络错误：handleNetworkError 发 service + turn-end failed', () => {
    const adapter = new SessionAdapter();
    const envs = adapter.handleNetworkError('ECONNREFUSED api.anthropic.com');
    expect(envs[0].ev).toEqual({ t: 'service', text: '**Network Error**: ECONNREFUSED api.anthropic.com' });
    expect(envs[1].ev).toEqual({ t: 'turn-end', status: 'failed' });
  });
});
