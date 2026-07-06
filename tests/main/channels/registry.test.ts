import { describe, it, expect, vi } from 'vitest';
import { ChannelDispatcher } from '../../../src/main/channels/registry.js';
import { OutputChannel, ProxyStageEvent } from '../../../src/main/channels/channel.js';

describe('ChannelDispatcher', () => {
  it('dispatches to enabled channels', async () => {
    const dispatcher = new ChannelDispatcher();
    const channel: OutputChannel = {
      id: 'test',
      name: 'Test',
      isEnabled: () => true,
      send: vi.fn(),
    };
    dispatcher.register(channel);
    const event: ProxyStageEvent = {
      seq: 1, turn: 1, sessionId: 's1', workDir: '/wd',
      kind: 'text', payload: { content: 'hi' }, timestamp: Date.now(),
    };
    await dispatcher.dispatch(event);
    expect(channel.send).toHaveBeenCalledWith(event);
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
    await dispatcher.dispatch({
      seq: 1, turn: 1, sessionId: 's1', workDir: '/wd',
      kind: 'text', payload: {}, timestamp: Date.now(),
    });
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
});
