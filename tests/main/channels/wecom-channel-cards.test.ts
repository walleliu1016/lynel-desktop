import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeComChannel } from '../../../src/main/channels/wecom-channel.js';
import { permissionBroker } from '../../../src/main/permission-broker.js';

describe('WeComChannel template cards', () => {
  let channel: WeComChannel;
  let sendMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessageMock = vi.fn().mockResolvedValue({ body: { msgid: 'msgid-123' } });
    channel = new WeComChannel({
      enabled: true,
      chatId: 'chat-1',
      botId: 'bot-1',
      secret: 'secret-1',
    });
    (channel as any).ensureWebSocket = vi.fn().mockResolvedValue(undefined);
    (channel as any).wsClient = {
      isConnected: true,
      sendMessage: sendMessageMock,
    };
  });

  afterEach(() => {
    permissionBroker.listPending().forEach((p) => permissionBroker.cancel(p.id));
  });

  it('sends template_card for PermissionRequest', async () => {
    channel.send({
      seq: 1,
      turn: 1,
      sessionId: 'sid-1',
      workDir: '/wd',
      kind: 'PermissionRequest',
      payload: {
        id: 'req-1',
        sessionId: 'sid-1',
        workDir: '/wd',
        toolName: 'BashCommand',
        toolInput: { command: 'ls' },
        seq: 1,
      },
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 50));

    const calls = sendMessageMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [, body] = calls[0];
    expect(body.msgtype).toBe('template_card');
    expect(body.template_card.card_type).toBe('button_interaction');
  });

  it('falls back to markdown when sendMessage fails', async () => {
    sendMessageMock.mockRejectedValue(new Error('network error'));
    const sendContentSpy = vi.spyOn(channel as any, 'sendContent').mockResolvedValue(undefined);

    channel.send({
      seq: 1,
      turn: 1,
      sessionId: 'sid-1',
      workDir: '/wd',
      kind: 'PermissionRequest',
      payload: {
        id: 'req-1',
        sessionId: 'sid-1',
        workDir: '/wd',
        toolName: 'BashCommand',
        toolInput: { command: 'ls' },
        seq: 1,
      },
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(sendContentSpy).toHaveBeenCalled();
  });
});
