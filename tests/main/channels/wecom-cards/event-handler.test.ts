import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeComCardEventHandler } from '../../../../src/main/channels/wecom-cards/event-handler.js';
import { WeComCardStore } from '../../../../src/main/channels/wecom-cards/card-store.js';
import { permissionBroker } from '../../../../src/main/permission-broker.js';

function makeFrame(overrides: Record<string, unknown> = {}) {
  const event = overrides.event as Record<string, unknown> | undefined;
  return {
    body: {
      chatid: overrides.chatid ?? 'chat-1',
      from: overrides.from as { userid?: string } | undefined,
      event: {
        eventtype: 'template_card_event',
        template_card_event: {
          event_key: event?.event_key as string | undefined,
          task_id: event?.task_id as string | undefined,
          selected_items: event?.selected_items as
            | { selected_item?: Array<{ question_key: string; option_ids?: { option_id?: string[] } }> }
            | undefined,
        },
      },
    },
  };
}

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

    await handler.handle(makeFrame({
      event: { event_key: 'wecom:allow:req-1' },
    }) as any);

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

    await handler.handle(makeFrame({
      event: { event_key: 'wecom:allow:req-1:extra' },
    }) as any);

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

    await handler.handle(makeFrame({
      event: { event_key: 'wecom:deny:req-1' },
    }) as any);

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

    await handler.handle(makeFrame({
      event: { event_key: 'wecom:allow:req-1' },
    }) as any);

    expect(replyFn).toHaveBeenCalledWith('chat-1', expect.stringContaining('已被处理'), expect.any(String));
    expect(updateCardFn).not.toHaveBeenCalled();
  });

  it('replies hint when request not found', async () => {
    await handler.handle(makeFrame({
      event: { event_key: 'wecom:allow:missing' },
    }) as any);

    expect(replyFn).toHaveBeenCalledWith('chat-1', expect.stringContaining('已被处理'), expect.any(String));
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

    await handler.handle(makeFrame({
      event: {
        event_key: 'wecom:submit:req-2',
        selected_items: {
          selected_item: [
            { question_key: 'wecom:answer:req-2:0', option_ids: { option_id: ['wecom:opt:req-2:0:1'] } },
          ],
        },
      },
    }) as any);

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

    await handler.handle(makeFrame({
      event: {
        event_key: 'wecom:submit:req-3',
        selected_items: {
          selected_item: [
            {
              question_key: 'wecom:answer:req-3:0',
              option_ids: { option_id: ['wecom:opt:req-3:0:0', 'wecom:opt:req-3:0:2'] },
            },
          ],
        },
      },
    }) as any);

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

    await handler.handle(makeFrame({
      event: {
        event_key: 'wecom:submit:req-2',
      },
    }) as any);

    expect(replyFn).toHaveBeenCalledWith('chat-1', '未选择任何选项', expect.any(String));
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
        event: {
          eventtype: 'template_card_event',
          template_card_event: { event_key: 'wecom:allow:req-1' },
        },
        from: { userid: 'user-1' },
      },
    } as any);

    await expect(p).resolves.toEqual({ decision: 'allow', answers: undefined });
    expect(updateCardFn).toHaveBeenCalled();
  });

  it('returns silently when no chatId available', async () => {
    await handler.handle({
      body: {
        event: {
          eventtype: 'template_card_event',
          template_card_event: { event_key: 'wecom:allow:req-1' },
        },
      },
    } as any);

    expect(replyFn).not.toHaveBeenCalled();
    expect(updateCardFn).not.toHaveBeenCalled();
  });

  it('replies unrecognised event key', async () => {
    await handler.handle(makeFrame({
      event: { event_key: 'invalid-key' },
    }) as any);

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

    await handler.handle(makeFrame({
      event: { event_key: 'wecom:unknown:req-1' },
    }) as any);

    expect(replyFn).toHaveBeenCalledWith('chat-1', '不支持的卡片操作。', expect.any(String));
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

    await handler.handle(makeFrame({
      event: { event_key: 'wecom:allow:req-1' },
    }) as any);

    await expect(p).resolves.toEqual({ decision: 'allow', answers: undefined });
    expect(replyFn).toHaveBeenCalledWith('chat-1', '已批准该权限请求。', expect.any(String));
  });

  it('多问题场景：第一张卡片提交后记录部分答案，不立即 resolve', async () => {
    const p = permissionBroker.wait({
      id: 'req-multi',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [
          { question: 'Q1', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
          { question: 'Q2', multiSelect: true, options: [{ label: 'C' }, { label: 'D' }] },
        ],
      },
    });
    store.save('req-multi', 1, 'chat-1', 'msgid-0', 'sid-1');
    store.addQuestionMsgid('req-multi', 0, 'msgid-0');
    store.addQuestionMsgid('req-multi', 1, 'msgid-1');

    // 提交第一张卡片（Q1 选 A）
    await handler.handle(makeFrame({
      event: {
        event_key: 'wecom:submit:req-multi',
        selected_items: {
          selected_item: [
            { question_key: 'wecom:answer:req-multi:0', option_ids: { option_id: ['wecom:opt:req-multi:0:0'] } },
          ],
        },
      },
    }) as any);

    // 此时不应 resolve（promise 仍在 pending）
    expect(store.get('req-multi')?.status).toBe('pending');
    expect(store.get('req-multi')?.questionAnswers?.get(0)).toBe('A');
    // updateSubmittedCard 应被调用
    expect(updateCardFn).toHaveBeenCalled();
  });

  it('多问题场景：全部提交后 resolve 累积答案', async () => {
    const p = permissionBroker.wait({
      id: 'req-multi2',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [
          { question: 'Q1', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
          { question: 'Q2', multiSelect: true, options: [{ label: 'C' }, { label: 'D' }] },
        ],
      },
    });
    store.save('req-multi2', 1, 'chat-1', 'msgid-0', 'sid-1');
    store.addQuestionMsgid('req-multi2', 0, 'msgid-0');
    store.addQuestionMsgid('req-multi2', 1, 'msgid-1');

    // 提交 Q1
    await handler.handle(makeFrame({
      event: {
        event_key: 'wecom:submit:req-multi2',
        selected_items: {
          selected_item: [
            { question_key: 'wecom:answer:req-multi2:0', option_ids: { option_id: ['wecom:opt:req-multi2:0:0'] } },
          ],
        },
      },
    }) as any);
    expect(store.get('req-multi2')?.status).toBe('pending');

    // 提交 Q2
    await handler.handle(makeFrame({
      event: {
        event_key: 'wecom:submit:req-multi2',
        selected_items: {
          selected_item: [
            { question_key: 'wecom:answer:req-multi2:1', option_ids: { option_id: ['wecom:opt:req-multi2:1:0', 'wecom:opt:req-multi2:1:1'] } },
          ],
        },
      },
    }) as any);

    // 此时应 resolve
    await expect(p).resolves.toEqual({
      decision: 'allow',
      answers: { Q1: 'A', Q2: ['C', 'D'] },
    });
    expect(store.get('req-multi2')?.status).toBe('resolved');
    expect(store.get('req-multi2')?.questionAnswers?.get(0)).toBe('A');
    expect(store.get('req-multi2')?.questionAnswers?.get(1)).toEqual(['C', 'D']);
  });
});
