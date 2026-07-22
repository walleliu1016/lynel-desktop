import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudChannel } from '../../../src/main/channels/cloud-channel.js';
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

  it('send 在禁用时不做任何事', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    channel.send(mkEnv());
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('send 在启用时 POST envelope 到云服务', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);

    channel.updateConfig({
      enabled: true,
      url: 'https://cloud.example.com',
      token: 'token123',
    });

    const env = mkEnv({ seq: 42, ev: { t: 'tool_use', name: 'bash', input: { cmd: 'ls' } } });
    channel.send(env);

    // fire-and-forget，等一个 microtick
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled(), { timeout: 1000 });

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://cloud.example.com/desktop/connect');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['Authorization']).toBe('Bearer token123');
    expect(JSON.parse(opts.body)).toEqual(env);

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

    // 不应抛出
    expect(() => channel.send(mkEnv())).not.toThrow();

    vi.unstubAllGlobals();
  });

  it('send HTTP 非 2xx 不抛异常', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });
    vi.stubGlobal('fetch', fetchSpy);

    channel.updateConfig({
      enabled: true,
      url: 'https://cloud.example.com',
      token: 'token123',
    });

    expect(() => channel.send(mkEnv())).not.toThrow();

    vi.unstubAllGlobals();
  });

  it('updateConfig 移除 url 末尾斜杠', () => {
    channel.updateConfig({
      enabled: true,
      url: 'https://cloud.example.com/',
      token: 'tok',
    });
    expect(channel.isEnabled()).toBe(true);

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    channel.send(mkEnv());

    return vi.waitFor(() => {
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://cloud.example.com/desktop/connect');
    }, { timeout: 1000 }).finally(() => vi.unstubAllGlobals());
  });
});
