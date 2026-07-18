import { describe, it, expect, beforeEach } from 'vitest';
import { WeComCardStore } from '../../../../src/main/channels/wecom-cards/card-store.js';

describe('WeComCardStore', () => {
  let store: WeComCardStore;

  beforeEach(() => {
    store = new WeComCardStore();
  });

  it('saves and retrieves card state', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1');
    const state = store.get('req-1');
    expect(state).toEqual({
      requestId: 'req-1',
      seq: 1,
      chatId: 'chat-1',
      msgid: 'msgid-1',
      status: 'pending',
      sentAt: expect.any(Number),
    });
  });

  it('returns undefined for unknown request', () => {
    expect(store.get('unknown')).toBeUndefined();
  });

  it('does not throw when resolving unknown request', () => {
    expect(() => store.resolve('unknown', 'allow')).not.toThrow();
    expect(store.get('unknown')).toBeUndefined();
  });

  it('does not throw when cancelling unknown request', () => {
    expect(() => store.cancel('unknown')).not.toThrow();
    expect(store.get('unknown')).toBeUndefined();
  });

  it('marks resolved with decision and answers', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1');
    store.resolve('req-1', 'allow', { q1: 'A' });
    const state = store.get('req-1');
    expect(state?.status).toBe('resolved');
    expect(state?.decision).toBe('allow');
    expect(state?.answers).toEqual({ q1: 'A' });
  });

  it('cancels by request id', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1');
    store.cancel('req-1');
    expect(store.get('req-1')?.status).toBe('cancelled');
  });

  it('cancels by session id', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1', 'sid-1');
    store.save('req-2', 2, 'chat-1', 'msgid-2', 'sid-1');
    store.cancelBySession('sid-1');
    expect(store.get('req-1')?.status).toBe('cancelled');
    expect(store.get('req-2')?.status).toBe('cancelled');
  });

  it('only cancels pending cards for target session', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1', 'sid-1');
    store.save('req-2', 2, 'chat-1', 'msgid-2', 'sid-2');
    store.cancelBySession('sid-1');
    expect(store.get('req-1')?.status).toBe('cancelled');
    expect(store.get('req-2')?.status).toBe('pending');
  });

  it('ignores resolve on non-pending state', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1');
    store.resolve('req-1', 'allow', { q1: 'A' });
    store.resolve('req-1', 'deny', { q1: 'B' });
    const state = store.get('req-1');
    expect(state?.status).toBe('resolved');
    expect(state?.decision).toBe('allow');
    expect(state?.answers).toEqual({ q1: 'A' });
  });

  it('ignores resolve after cancel', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1');
    store.cancel('req-1');
    store.resolve('req-1', 'allow');
    expect(store.get('req-1')?.status).toBe('cancelled');
  });

  it('ignores cancel after resolve', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1');
    store.resolve('req-1', 'allow');
    store.cancel('req-1');
    expect(store.get('req-1')?.status).toBe('resolved');
  });

  it('stays cancelled after cancelling twice', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1');
    store.cancel('req-1');
    store.cancel('req-1');
    expect(store.get('req-1')?.status).toBe('cancelled');
  });
});
