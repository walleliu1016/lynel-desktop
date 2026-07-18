import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeComCardEventHandler } from '../../../../src/main/channels/wecom-cards/event-handler.js';
import { WeComCardStore } from '../../../../src/main/channels/wecom-cards/card-store.js';
import { permissionBroker } from '../../../../src/main/permission-broker.js';

describe('WeComCardEventHandler', () => {
  let store: WeComCardStore;
  let handler: WeComCardEventHandler;
  let replyFn: ReturnType<typeof vi.fn>;
  let updateCardFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new WeComCardStore();
    replyFn = vi.fn().mockResolvedValue(undefined);
    updateCardFn = vi.fn().mockResolvedValue(undefined);
    handler = new WeComCardEventHandler(store, replyFn, updateCardFn);
  });

  afterEach(() => {
    permissionBroker.listPending().forEach((p) => permissionBroker.cancel(p.id));
  });

  it('resolves allow decision', async () => {
    const p = permissionBroker.wait({
      id: 'req-1',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'BashCommand',
      toolInput: {},
    });
    store.save('req-1', 1, 'chat-1', 'msgid-1', 'sid-1');

    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'wecom:allow:req-1' },
        chatid: 'chat-1',
      },
    } as any);

    await expect(p).resolves.toEqual({ decision: 'allow', answers: undefined });
    expect(updateCardFn).toHaveBeenCalled();
    expect(store.get('req-1')?.status).toBe('resolved');
    expect(store.get('req-1')?.decision).toBe('allow');
  });

  it('ignores extra segments in event key', async () => {
    const p = permissionBroker.wait({
      id: 'req-1',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'BashCommand',
      toolInput: {},
    });
    store.save('req-1', 1, 'chat-1', 'msgid-1', 'sid-1');

    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'wecom:allow:req-1:extra' },
        chatid: 'chat-1',
      },
    } as any);

    await expect(p).resolves.toEqual({ decision: 'allow', answers: undefined });
  });

  it('resolves deny decision', async () => {
    const p = permissionBroker.wait({
      id: 'req-1',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'BashCommand',
      toolInput: {},
    });
    store.save('req-1', 1, 'chat-1', 'msgid-1', 'sid-1');

    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'wecom:deny:req-1' },
        chatid: 'chat-1',
      },
    } as any);

    await expect(p).resolves.toEqual({ decision: 'deny', answers: undefined });
    expect(updateCardFn).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ chatid: 'chat-1' }),
      }),
      {
        card_type: 'text_notice',
        source: { desc: 'Lynel', desc_color: 0 },
        main_title: { title: '已拒绝该权限请求。' },
      },
    );
  });

  it('replies hint when request already resolved', async () => {
    permissionBroker.wait({
      id: 'req-1',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'BashCommand',
      toolInput: {},
    });
    store.save('req-1', 1, 'chat-1', 'msgid-1', 'sid-1');
    permissionBroker.resolve('req-1', 'allow', 'wecom');

    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'wecom:allow:req-1' },
        chatid: 'chat-1',
      },
    } as any);

    expect(replyFn).toHaveBeenCalledWith('chat-1', expect.stringContaining('已被处理'));
    expect(updateCardFn).not.toHaveBeenCalled();
  });

  it('replies hint when request not found', async () => {
    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'wecom:allow:missing' },
        chatid: 'chat-1',
      },
    } as any);

    expect(replyFn).toHaveBeenCalledWith('chat-1', expect.stringContaining('已被处理'));
  });

  it('resolves AskUserQuestion with selected options', async () => {
    const p = permissionBroker.wait({
      id: 'req-2',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [{ question: 'Q1', options: [{ label: 'A' }, { label: 'B' }] }],
      },
    });
    store.save('req-2', 2, 'chat-1', 'msgid-2', 'sid-1');

    await handler.handle({
      body: {
        event: {
          eventtype: 'template_card_event',
          event_key: 'wecom:submit:req-2',
          selected_items: [
            { question_key: 'wecom:answer:req-2:0', option_ids: ['wecom:opt:req-2:0:1'] },
          ],
        },
        chatid: 'chat-1',
      },
    } as any);

    await expect(p).resolves.toEqual({
      decision: 'allow',
      answers: { Q1: 'B' },
    });
    expect(updateCardFn).toHaveBeenCalled();
    expect(store.get('req-2')?.answers).toEqual({ Q1: 'B' });
  });

  it('supports multi-select answers', async () => {
    const p = permissionBroker.wait({
      id: 'req-3',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [
          {
            question: '依赖',
            multiSelect: true,
            options: [{ label: 'eslint' }, { label: 'prettier' }, { label: 'vitest' }],
          },
        ],
      },
    });
    store.save('req-3', 3, 'chat-1', 'msgid-3', 'sid-1');

    await handler.handle({
      body: {
        event: {
          eventtype: 'template_card_event',
          event_key: 'wecom:submit:req-3',
          selected_items: [
            {
              question_key: 'wecom:answer:req-3:0',
              option_ids: ['wecom:opt:req-3:0:0', 'wecom:opt:req-3:0:2'],
            },
          ],
        },
        chatid: 'chat-1',
      },
    } as any);

    await expect(p).resolves.toEqual({
      decision: 'allow',
      answers: { 依赖: ['eslint', 'vitest'] },
    });
  });

  it('replies error when submit has no selected_items', async () => {
    permissionBroker.wait({
      id: 'req-2',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [{ question: 'Q1', options: [{ label: 'A' }] }],
      },
    });
    store.save('req-2', 2, 'chat-1', 'msgid-2', 'sid-1');

    await handler.handle({
      body: {
        event: {
          eventtype: 'template_card_event',
          event_key: 'wecom:submit:req-2',
        },
        chatid: 'chat-1',
      },
    } as any);

    expect(replyFn).toHaveBeenCalledWith('chat-1', '未选择任何选项');
    expect(updateCardFn).not.toHaveBeenCalled();
  });

  it('extracts chatId from from.userid when chatid missing', async () => {
    const p = permissionBroker.wait({
      id: 'req-1',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'BashCommand',
      toolInput: {},
    });
    store.save('req-1', 1, 'user-1', 'msgid-1', 'sid-1');

    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'wecom:allow:req-1' },
        from: { userid: 'user-1' },
      },
    } as any);

    await expect(p).resolves.toEqual({ decision: 'allow', answers: undefined });
    expect(updateCardFn).toHaveBeenCalled();
  });

  it('returns silently when no chatId available', async () => {
    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'wecom:allow:req-1' },
      },
    } as any);

    expect(replyFn).not.toHaveBeenCalled();
    expect(updateCardFn).not.toHaveBeenCalled();
  });

  it('replies unrecognised event key', async () => {
    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'invalid-key' },
        chatid: 'chat-1',
      },
    } as any);

    expect(replyFn).toHaveBeenCalledWith('chat-1', '无法识别的卡片操作。');
  });

  it('replies unsupported action', async () => {
    permissionBroker.wait({
      id: 'req-1',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'BashCommand',
      toolInput: {},
    });
    store.save('req-1', 1, 'chat-1', 'msgid-1', 'sid-1');

    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'wecom:unknown:req-1' },
        chatid: 'chat-1',
      },
    } as any);

    expect(replyFn).toHaveBeenCalledWith('chat-1', '不支持的卡片操作。');
  });

  it('falls back to sendReply when updateCard fails', async () => {
    updateCardFn.mockRejectedValue(new Error('network'));
    const p = permissionBroker.wait({
      id: 'req-1',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'BashCommand',
      toolInput: {},
    });
    store.save('req-1', 1, 'chat-1', 'msgid-1', 'sid-1');

    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'wecom:allow:req-1' },
        chatid: 'chat-1',
      },
    } as any);

    await expect(p).resolves.toEqual({ decision: 'allow', answers: undefined });
    expect(replyFn).toHaveBeenCalledWith('chat-1', '已批准该权限请求。');
  });
});
