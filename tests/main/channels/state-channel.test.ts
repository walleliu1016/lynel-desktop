import { describe, it, expect } from 'vitest';
import { StateChannel } from '../../../src/main/channels/state-channel.js';
import { createEnvelope } from '../../../src/main/protocol/envelope.js';
import type { SessionEvent } from '../../../src/main/protocol/events.js';

interface ActivityCall {
  sessionId: string;
  phase: string;
  tool?: string;
  toolInput?: string;
}

function makeChannel() {
  const activities: ActivityCall[] = [];
  const states: Array<{ sessionId: string; state: string }> = [];
  const ch = new StateChannel({
    onActivity: (sessionId, a) => activities.push({ sessionId, ...a }),
    onStableState: (sessionId, state) => states.push({ sessionId, state }),
  });
  return { ch, activities, states };
}

function env(sessionId: string, ev: SessionEvent, role: 'user' | 'agent' = 'agent') {
  return createEnvelope(role, ev, { seq: 1, sessionId });
}

describe('StateChannel activity 去重', () => {
  it('流式期间的重复 streaming activity 只发一次', () => {
    const { ch, activities } = makeChannel();
    for (let i = 0; i < 50; i++) {
      ch.send(env('s1', { t: 'text', text: `delta-${i}` }));
    }
    expect(activities).toEqual([{ sessionId: 's1', phase: 'streaming' }]);
  });

  it('phase 变化时正常发出', () => {
    const { ch, activities } = makeChannel();
    ch.send(env('s1', { t: 'text', text: 'a' }));
    ch.send(env('s1', { t: 'text', text: 'b', thinking: true }));
    ch.send(env('s1', { t: 'turn-end', status: 'completed' }));
    expect(activities.map((a) => a.phase)).toEqual(['streaming', 'thinking', 'idle']);
  });

  it('相同 phase 变回时会再次发出（A→B→A 不去重掉第二个 A）', () => {
    const { ch, activities } = makeChannel();
    ch.send(env('s1', { t: 'text', text: 'a' }));
    ch.send(env('s1', { t: 'tool-call-start', call: 'c1', name: 'Bash', title: '', description: '', args: { command: 'ls' } }));
    ch.send(env('s1', { t: 'tool-call-end', call: 'c1' }));
    ch.send(env('s1', { t: 'text', text: 'b' }));
    expect(activities.map((a) => a.phase)).toEqual(['streaming', 'working', 'thinking', 'streaming']);
  });

  it('tool-call-start 相同 tool+input 的重复 activity 去重', () => {
    const { ch, activities } = makeChannel();
    const ev: SessionEvent = { t: 'tool-call-start', call: 'c1', name: 'Bash', title: '', description: '', args: { command: 'ls' } };
    ch.send(env('s1', ev));
    ch.send(env('s1', ev));
    expect(activities).toHaveLength(1);
  });

  it('不同 session 的去重状态互不影响', () => {
    const { ch, activities } = makeChannel();
    ch.send(env('s1', { t: 'text', text: 'a' }));
    ch.send(env('s2', { t: 'text', text: 'a' }));
    expect(activities).toHaveLength(2);
  });

  it('onStableState 不参与去重，每次照常发出', () => {
    const { ch, states } = makeChannel();
    ch.send(env('s1', { t: 'turn-start' }));
    ch.send(env('s1', { t: 'turn-start' }));
    expect(states).toHaveLength(2);
  });
});
