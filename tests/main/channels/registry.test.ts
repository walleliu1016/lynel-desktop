import { describe, it, expect, vi } from 'vitest';
import { ChannelDispatcher } from '../../../src/main/channels/registry.js';
import { OutputChannel, HookChannel, type HookEventLike } from '../../../src/main/channels/channel.js';
import type { LynelEnvelope } from '../../../src/main/protocol/envelope.js';

function mkEnv(): LynelEnvelope {
  return {
    id: 'c1',
    time: Date.now(),
    role: 'user',
    seq: 1,
    ev: { t: 'text', text: 'hi' },
  };
}

function mkHook(): HookEventLike {
  return { kind: 'UserPromptSubmit', sessionId: 's1', workDir: '/wd', payload: {} };
}

describe('ChannelDispatcher', () => {
  it('dispatches envelope to enabled channels', async () => {
    const dispatcher = new ChannelDispatcher();
    const channel: OutputChannel = {
      id: 'test',
      name: 'Test',
      isEnabled: () => true,
      send: vi.fn(),
    };
    dispatcher.register(channel);
    const env = mkEnv();
    await dispatcher.dispatch(env);
    expect(channel.send).toHaveBeenCalledWith(env);
  });

  it('skips disabled channels', async () => {
    const dispatcher = new ChannelDispatcher();
    const channel: OutputChannel = {
      id: 'disabled',
      name: 'Disabled',
      isEnabled: () => false,
      send: vi.fn(),
    };
    dispatcher.register(channel);
    await dispatcher.dispatch(mkEnv());
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('lists registered channels', () => {
    const dispatcher = new ChannelDispatcher();
    const channel: OutputChannel = {
      id: 'list',
      name: 'List',
      isEnabled: () => true,
      send: vi.fn(),
    };
    dispatcher.register(channel);
    expect(dispatcher.list()).toHaveLength(1);
    dispatcher.unregister('list');
    expect(dispatcher.list()).toHaveLength(0);
  });

  it('dispatches hook events to hook channels', async () => {
    const dispatcher = new ChannelDispatcher();
    const channel: HookChannel = {
      id: 'hook1',
      name: 'Hook',
      isEnabled: () => true,
      sendHook: vi.fn(),
    };
    dispatcher.registerHook(channel);
    const h = mkHook();
    await dispatcher.dispatchHook(h);
    expect(channel.sendHook).toHaveBeenCalledWith(h);
  });
});
