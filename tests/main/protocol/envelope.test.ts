import { describe, it, expect } from 'vitest';
import { createEnvelope, stripEnvelope, type LynelEnvelope } from '../../../src/main/protocol/envelope.js';
import { canCarryUsage } from '../../../src/main/protocol/events.js';
import { makeUsage } from '../../../src/main/protocol/usage.js';

describe('createEnvelope', () => {
  it('构造最小 envelope', () => {
    const env = createEnvelope('user', { t: 'text', text: 'hi' }, { seq: 1 });
    expect(env.role).toBe('user');
    expect(env.seq).toBe(1);
    expect(env.ev.t).toBe('text');
    expect(env.time).toBeGreaterThan(0);
    expect(env.id.length).toBeGreaterThan(0);
  });

  it('带 turn + claudeUuid', () => {
    const env = createEnvelope('agent', { t: 'text', text: 'reply' }, {
      seq: 2, turn: 't1', claudeUuid: 'uuid-1', claudeMsgId: 'msg-1',
    });
    expect(env.turn).toBe('t1');
    expect(env.claudeUuid).toBe('uuid-1');
    expect(env.claudeMsgId).toBe('msg-1');
  });

  it('带 usage', () => {
    const env = createEnvelope('agent', { t: 'text', text: 'x' }, {
      seq: 1, turn: 't1',
      usage: makeUsage({ input_tokens: 100, output_tokens: 50 }),
    });
    expect(env.usage?.input_tokens).toBe(100);
  });
});

describe('stripEnvelope', () => {
  it('剔除 undefined 字段', () => {
    const env = createEnvelope('user', { t: 'text', text: 'hi' }, { seq: 1 });
    const json = stripEnvelope(env);
    expect(json.role).toBe('user');
    expect(json.seq).toBe(1);
    expect('turn' in json).toBe(false);
    expect('usage' in json).toBe(false);
  });

  it('保留已设置的可选字段', () => {
    const env = createEnvelope('agent', { t: 'text', text: 'x' }, { seq: 1, turn: 't1' });
    const json = stripEnvelope(env);
    expect(json.turn).toBe('t1');
  });
});

describe('canCarryUsage', () => {
  it('turn-start/turn-end/start/stop 不可携带', () => {
    expect(canCarryUsage({ t: 'turn-start' })).toBe(false);
    expect(canCarryUsage({ t: 'turn-end', status: 'completed' })).toBe(false);
    expect(canCarryUsage({ t: 'start' })).toBe(false);
    expect(canCarryUsage({ t: 'stop' })).toBe(false);
  });

  it('text/service/tool-call-start/tool-call-end 可携带', () => {
    expect(canCarryUsage({ t: 'text', text: 'x' })).toBe(true);
    expect(canCarryUsage({ t: 'service', text: 'x' })).toBe(true);
    expect(canCarryUsage({ t: 'tool-call-start', call: 'c', name: 'n', title: '', description: '', args: {} })).toBe(true);
    expect(canCarryUsage({ t: 'tool-call-end', call: 'c' })).toBe(true);
  });
});
