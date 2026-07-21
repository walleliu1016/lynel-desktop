import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WeComChannel } from '../../../src/main/channels/wecom-channel.js';
import type { LynelEnvelope } from '../../../src/main/protocol/envelope.js';

function mkEnv(overrides: Partial<LynelEnvelope> = {}): LynelEnvelope {
  return {
    id: 'e1',
    time: Date.now(),
    role: 'agent',
    sessionId: 'sid-1',
    seq: 1,
    ev: { t: 'text', text: 'hello' },
    ...overrides,
  } as LynelEnvelope;
}

describe('WeComChannel (LynelEnvelope API)', () => {
  let channel: WeComChannel;

  beforeEach(() => {
    channel = new WeComChannel({
      enabled: true,
      chatId: 'chat-1',
      botId: 'bot-1',
      secret: 'secret-1',
    });

    // 用 BotConfig 初始化 bot 连接池
    const botConfig = { id: 'b1', name: 'test-bot', botId: 'bot-1', secret: 'secret-1', chatId: 'chat-1', createdAt: Date.now(), updatedAt: Date.now() };
    channel.updateBots([botConfig]);
    channel.setSessionBot('sid-1', 'b1');

    // mock plugin 加载
    (channel as any).sendContent = vi.fn().mockResolvedValue(undefined);
  });

  it('send() 忽略 sessionId 为空的事件', () => {
    const env = mkEnv({ sessionId: undefined });
    expect(() => channel.send(env)).not.toThrow();
  });

  it('send() 处理 user text 事件', () => {
    const env = mkEnv({ role: 'user', ev: { t: 'text', text: '帮我查一下' } });
    channel.send(env);
    expect((channel as any).sendContent).toHaveBeenCalledWith(
      expect.stringContaining('帮我查一下'),
      'sid-1',
    );
  });

  it('send() 发送 agent text 事件', () => {
    const env = mkEnv({ role: 'agent', turn: 't1', ev: { t: 'text', text: '好的，我来帮你' } });
    channel.send(env);
    expect((channel as any).sendContent).toHaveBeenCalledWith(
      expect.stringContaining('好的，我来帮你'),
      'sid-1',
    );
  });

  it('send() 处理 tool-call-start 事件', () => {
    const env = mkEnv({
      turn: 't1',
      ev: { t: 'tool-call-start', call: 'c1', name: 'Bash', title: '运行命令', description: '', args: { command: 'ls' } },
    });
    channel.send(env);
    expect((channel as any).sendContent).toHaveBeenCalled();
  });

  it('send() 处理 tool-call-end 事件', () => {
    const env = mkEnv({
      turn: 't1',
      ev: { t: 'tool-call-end', call: 'c1', is_error: false },
    });
    channel.send(env);
    expect((channel as any).sendContent).toHaveBeenCalledWith(
      expect.stringContaining('工具执行完成'),
      'sid-1',
    );
  });

  it('send() 处理 service 事件', () => {
    const env = mkEnv({ ev: { t: 'service', text: '请求超时' } });
    channel.send(env);
    expect((channel as any).sendContent).toHaveBeenCalledWith(
      expect.stringContaining('请求超时'),
      'sid-1',
    );
  });

  it('send() 处理 turn-end 事件', () => {
    const env = mkEnv({ turn: 't1', ev: { t: 'turn-end', status: 'completed' } });
    channel.send(env);
    expect((channel as any).sendContent).toHaveBeenCalledWith(
      expect.stringContaining('Turn 结束'),
      'sid-1',
    );
  });

  it('send() 忽略 turn-start/start/stop/file 事件', () => {
    for (const t of ['turn-start', 'start', 'stop', 'file'] as const) {
      const env = mkEnv({ ev: { t } as any });
      expect(() => channel.send(env)).not.toThrow();
    }
  });

  it('close() 断开连接', () => {
    channel.send(mkEnv({ role: 'agent', turn: 't1', ev: { t: 'text', text: 'x' } }));
    expect(() => channel.close()).not.toThrow();
  });

  it('sendHook() 不抛异常', () => {
    expect(() => channel.sendHook({
      kind: 'SessionStart',
      sessionId: 'sid-1',
      workDir: '/wd',
      payload: {},
    })).not.toThrow();
  });

  it('clearSessionMappings() 清理路由', () => {
    const chatIdToSession = (channel as any).chatIdToSession;
    chatIdToSession.set('chat-1', 'sid-1');
    chatIdToSession.set('chat-2', 'sid-1');
    chatIdToSession.set('chat-3', 'sid-2');
    channel.clearSessionMappings('sid-1');
    expect(chatIdToSession.has('chat-1')).toBe(false);
    expect(chatIdToSession.has('chat-2')).toBe(false);
    expect(chatIdToSession.has('chat-3')).toBe(true);
  });
});