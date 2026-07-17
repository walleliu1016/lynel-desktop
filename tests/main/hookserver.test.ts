import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HookServer } from '../../src/main/hookserver.js';

describe('hookserver', () => {
  let server: HookServer;

  beforeEach(async () => {
    server = new HookServer();
    await server.start(0);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('starts on random port', () => {
    expect(server.getPort()).toBeGreaterThan(0);
  });

  it('receives hook event', async () => {
    const events: any[] = [];
    server.onEvent((e) => events.push(e));
    const res = await fetch(server.url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1' }),
    });
    expect(res.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].session_id).toBe('s1');
  });

  it('tracks last seen per session', async () => {
    await fetch(server.url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'Ping', session_id: 's2' }),
    });
    expect(server.lastSeen('s2')).toBeGreaterThan(0);
    expect(server.lastSeen('unknown')).toBe(0);
  });

  it('routes send handler', async () => {
    server.onSend(async (sid, prompt) => {
      if (sid === 's3' && prompt === 'hi') return { ok: true };
      return { ok: false, error: 'bad' };
    });
    const res = await fetch(`http://127.0.0.1:${server.getPort()}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's3', prompt: 'hi' }),
    });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('handles PermissionRequest via permission handler', async () => {
    server.onPermissionRequest(async (evt) => ({ id: evt.request?.id ?? 'r1', allowed: false }));
    const res = await fetch(server.url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'PermissionRequest',
        session_id: 's4',
        request: { id: 'r1', tool: 'bash' },
      }),
    });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny' },
      },
    });
  });
});
