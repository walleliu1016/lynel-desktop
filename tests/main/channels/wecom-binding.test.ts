import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WeComChannel } from '../../../src/main/channels/wecom-channel.js';
import { newSession, register } from '../../../src/main/session.js';

/** 企微绑定路由的回归测试。
 *  踩过的坑：/clear、/resume 触发 session.rebind 后 sessionId 变了，
 *  但 sessionBotMap 与路由兜底表还指着旧 id —— 出站全部丢失、入站命中死 id。 */

function mkBot(id: string) {
  return { id, name: id, botId: `bot-${id}`, secret: 's', chatId: `chat-${id}`, createdAt: 1, updatedAt: 1 };
}

describe('WeComChannel 绑定迁移（/clear、/resume 后 rebind）', () => {
  let channel: WeComChannel;

  beforeEach(() => {
    channel = new WeComChannel({ enabled: true, chatId: '', botId: '', secret: '' });
    channel.updateBots([mkBot('b1')]);
  });

  it('rebindSessionBot 把绑定从旧 id 迁到新 id，出站走新 id', () => {
    channel.setSessionBot('old-sid', 'b1');
    (channel as any).rebindSessionBot('old-sid', 'new-sid');

    expect((channel as any).sessionBotMap.get('new-sid')).toBe('b1');
    expect((channel as any).sessionBotMap.has('old-sid')).toBe(false);
  });

  it('rebindSessionBot 后按 bot 反查入站路由命中新 id', () => {
    channel.setSessionBot('old-sid', 'b1');
    (channel as any).currentBotId = 'b1';
    (channel as any).rebindSessionBot('old-sid', 'new-sid');
    expect((channel as any).resolveBoundSessionId('any-chat')).toBe('new-sid');
  });

  it('rebindSessionBot 迁移路由兜底表（chatIdToSession / 持久化 mapping）', () => {
    const s = newSession('old-sid', '/wd');
    register(s);
    (channel as any).recordRouting('chat-r', 'old-sid');
    (channel as any).rebindSessionBot('old-sid', 'new-sid');

    // 内存兜底
    expect((channel as any).chatIdToSession.get('chat-r')).toBe('new-sid');
    expect((channel as any).lastActiveSession.get('chat-r')).toBe('new-sid');
    // currentBotId 未设置时，入站按兜底表解析
    expect((channel as any).resolveBoundSessionId('chat-r')).toBe('new-sid');
  });

  it('rebindSessionBot 对未绑定的会话是 no-op，不给新 id 凭空建绑定', () => {
    (channel as any).rebindSessionBot('ghost-sid', 'new-sid');
    expect((channel as any).sessionBotMap.has('new-sid')).toBe(false);
    expect((channel as any).resolveBoundSessionId('any-chat')).toBeUndefined();
  });

  it('clearSessionBot 清掉绑定与路由兜底，不留死会话指针', () => {
    const s = newSession('del-sid', '/wd');
    register(s);
    channel.setSessionBot('del-sid', 'b1');
    (channel as any).recordRouting('chat-d', 'del-sid');

    channel.clearSessionBot('del-sid');

    expect((channel as any).sessionBotMap.has('del-sid')).toBe(false);
    expect((channel as any).chatIdToSession.has('chat-d')).toBe(false);
    expect((channel as any).lastActiveSession.has('chat-d')).toBe(false);
    // 持久化 mapping 也必须清：残留会让新绑定被旧 key 的兜底抢先命中
    expect((channel as any).resolveBoundSessionId('chat-d')).toBeUndefined();
  });
});

describe('WeComChannel 入站路由记录（出站/入站 key 对齐）', () => {
  let channel: WeComChannel;
  const chatId = 'in-chat-1';

  beforeEach(() => {
    channel = new WeComChannel({ enabled: true, chatId: '', botId: '', secret: '' });
    channel.updateBots([mkBot('b1')]);
    const s = newSession('in-sid-1', '/wd');
    s.process = { write: () => {} } as any;
    register(s);
    channel.setSessionBot('in-sid-1', 'b1');
    (channel as any).sendWeComReply = () => Promise.resolve();
  });

  afterEach(() => {
    // 持久化 mapping 落在真实 ~/.lynel-desktop/wecom-routing.json，测试完清掉自己的 key
    (channel as any).clearSessionMappings('in-sid-1');
  });

  it('入站转发成功后记录路由，同 chatId 的兜底解析可用', () => {
    (channel as any).handleInboundMessage(
      { body: { chatid: chatId, msgtype: 'text', text: { content: 'hello' } } },
      'b1',
    );
    // 出站 send 用 effectiveChatId 记录，入站用 body.chatid —— 两边 key 必须都有记录，
    // 否则出站记过的 key 入站查不到（或反过来），兜底路由退化。
    expect((channel as any).chatIdToSession.get(chatId)).toBe('in-sid-1');
  });
});
