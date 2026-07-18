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

    await vi.waitFor(() => expect(sendMessageMock.mock.calls.length).toBeGreaterThan(0));

    const [, body] = sendMessageMock.mock.calls[0];
    expect(body.msgtype).toBe('template_card');
    expect(body.template_card.card_type).toBe('button_interaction');
  });

  it('sends vote_interaction template_card for single-select AskUserQuestion', async () => {
    channel.send({
      seq: 2,
      turn: 1,
      sessionId: 'sid-1',
      workDir: '/wd',
      kind: 'PermissionRequest',
      payload: {
        id: 'req-2',
        sessionId: 'sid-1',
        workDir: '/wd',
        toolName: 'AskUserQuestion',
        toolInput: {
          questions: [
            {
              header: '选择部署环境',
              question: '请选择要部署的环境',
              multiSelect: false,
              options: [
                { label: '测试环境', description: 'test' },
                { label: '生产环境', description: 'prod' },
              ],
            },
          ],
        },
        seq: 2,
      },
      timestamp: Date.now(),
    });

    await vi.waitFor(() => expect(sendMessageMock.mock.calls.length).toBeGreaterThan(0));

    const [, body] = sendMessageMock.mock.calls[0];
    expect(body.msgtype).toBe('template_card');
    expect(body.template_card.card_type).toBe('vote_interaction');
  });

  it('falls back to markdown when AskUserQuestion questions array is empty', async () => {
    const sendContentSpy = vi.spyOn(channel as any, 'sendContent').mockResolvedValue(undefined);

    channel.send({
      seq: 3,
      turn: 1,
      sessionId: 'sid-1',
      workDir: '/wd',
      kind: 'PermissionRequest',
      payload: {
        id: 'req-3',
        sessionId: 'sid-1',
        workDir: '/wd',
        toolName: 'AskUserQuestion',
        toolInput: { questions: [] },
        seq: 3,
      },
      timestamp: Date.now(),
    });

    await vi.waitFor(() => expect(sendContentSpy).toHaveBeenCalled());

    expect(sendContentSpy).toHaveBeenCalledWith(expect.stringContaining('/answer'), expect.any(String));
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

    await vi.waitFor(() => expect(sendContentSpy).toHaveBeenCalled());

    expect(sendContentSpy).toHaveBeenCalledWith(expect.stringContaining('/allow'), expect.any(String));
  });
});
