import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudChannel, type SyncSession } from '../../../src/main/channels/cloud-channel.js';
import type { LynelEnvelope } from '../../../src/main/protocol/envelope.js';

function mkEnv(overrides: Partial<LynelEnvelope> = {}): LynelEnvelope {
  return {
    id: 'ev1',
    time: Date.now(),
    role: 'user',
    seq: 1,
    ev: { t: 'text', text: 'hello' },
    sessionId: 's1',
    ...overrides,
  };
}

describe('CloudChannel', () => {
  let channel: CloudChannel;

  beforeEach(() => {
    channel = new CloudChannel();
  });

  it('默认禁用', () => {
    expect(channel.isEnabled()).toBe(false);
  });

  it('仅 enabled 但无 url/token 仍然禁用', () => {
    channel.updateConfig({ enabled: true });
    expect(channel.isEnabled()).toBe(false);
  });

  it('有 url + token + enabled 时启用', () => {
    channel.updateConfig({
      enabled: true,
      url: 'https://cloud.example.com',
      token: 'secret',
    });
    expect(channel.isEnabled()).toBe(true);
  });

  it('send 在禁用时不做任何事（buffer 为空）', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    channel.send(mkEnv());
    channel.close();
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('send 在启用时批量 POST envelopes 到 /api/envelope/push', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);

    channel.updateConfig({
      enabled: true,
      url: 'https://cloud.example.com',
      token: 'token123',
      userId: 'alice',
    });

    const env = mkEnv({ seq: 42 });
    channel.send(env);
    channel.close(); // flush buffer

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled(), { timeout: 1000 });

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://cloud.example.com/api/envelope/push');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['Authorization']).toBe('Bearer token123');
    const body = JSON.parse(opts.body);
    expect(body.user_id).toBe('alice');
    expect(body.from).toBe('desktop');
    expect(body.envelopes).toEqual([env]);

    vi.unstubAllGlobals();
  });

  it('send 网络错误不抛异常', () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchSpy);

    channel.updateConfig({
      enabled: true,
      url: 'https://cloud.example.com',
      token: 'token123',
    });

    expect(() => channel.send(mkEnv())).not.toThrow();
    // close 也不应抛异常
    expect(() => channel.close()).not.toThrow();

    vi.unstubAllGlobals();
  });

  it('send HTTP 非 2xx 不抛异常', () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });
    vi.stubGlobal('fetch', fetchSpy);

    channel.updateConfig({
      enabled: true,
      url: 'https://cloud.example.com',
      token: 'token123',
    });

    expect(() => channel.send(mkEnv())).not.toThrow();
    channel.close();

    vi.unstubAllGlobals();
  });

  it('updateConfig 移除 url 末尾斜杠', () => {
    channel.updateConfig({
      enabled: true,
      url: 'https://cloud.example.com/',
      token: 'tok',
      userId: 'u1',
    });
    expect(channel.isEnabled()).toBe(true);

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    channel.send(mkEnv());
    channel.close();

    return vi.waitFor(() => {
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://cloud.example.com/api/envelope/push');
    }, { timeout: 1000 }).finally(() => vi.unstubAllGlobals());
  });

  it('syncSessions 在启用时 POST 到 /api/sessions/sync', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);

    channel.updateConfig({
      enabled: true,
      url: 'https://cloud.example.com',
      token: 'token123',
      userId: 'alice',
    });

    const sessions: SyncSession[] = [{
      session_id: 's1',
      cwd: '/home/alice/work',
      project_name: 'app',
      title: '实现登录',
      last_activity_at: 1753280000,
    }];

    await channel.syncSessions(sessions);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://cloud.example.com/api/sessions/sync');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe('Bearer token123');
    const body = JSON.parse(opts.body);
    expect(body.user_id).toBe('alice');
    expect(body.sessions).toEqual(sessions);

    vi.unstubAllGlobals();
  });

  it('syncSessions 在禁用时不做任何事', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    channel.syncSessions([{ session_id: 's1' }]);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('close 后 enabled 变为 false', () => {
    channel.updateConfig({
      enabled: true,
      url: 'https://cloud.example.com',
      token: 'tok',
    });
    expect(channel.isEnabled()).toBe(true);
    channel.close();
    expect(channel.isEnabled()).toBe(false);
  });
});
