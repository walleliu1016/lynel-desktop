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

  // ============ hook 上行：sendHook 非审批类 batch ============

  it('sendHook 跳过 PermissionRequest（由 sendPermissionRequest 接管）', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    vi.stubGlobal('fetch', fetchSpy);
    channel.updateConfig({ enabled: true, url: 'https://cloud.example.com', token: 'tok' });

    channel.sendHook({
      kind: 'PermissionRequest',
      sessionId: 's1',
      workDir: '/w',
      payload: {},
      rawBody: { hook_event_name: 'PermissionRequest', session_id: 's1' },
    });
    channel.close();
    // 不应触发 /api/hook（PermissionRequest 走 sendPermissionRequest）
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('sendHook 跳过 PermissionResolved（broker 内部合成事件）', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    vi.stubGlobal('fetch', fetchSpy);
    channel.updateConfig({ enabled: true, url: 'https://cloud.example.com', token: 'tok' });

    channel.sendHook({
      kind: 'PermissionResolved',
      sessionId: 's1',
      workDir: '/w',
      payload: { id: 'r1', decision: 'allow' },
    });
    channel.close();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('sendHook 跳过无 rawBody 的事件', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    vi.stubGlobal('fetch', fetchSpy);
    channel.updateConfig({ enabled: true, url: 'https://cloud.example.com', token: 'tok' });

    channel.sendHook({ kind: 'PreToolUse', sessionId: 's1', workDir: '/w', payload: {} });
    channel.close();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('sendHook 非审批类批量 POST 到 /api/hook，body 为 {action,from,data:[…]}', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    vi.stubGlobal('fetch', fetchSpy);
    channel.updateConfig({ enabled: true, url: 'https://cloud.example.com', token: 'tok' });

    const r1 = { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'bash' };
    const r2 = { hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'bash' };
    channel.sendHook({ kind: 'PreToolUse', sessionId: 's1', workDir: '/w', payload: {}, rawBody: r1 });
    channel.sendHook({ kind: 'PostToolUse', sessionId: 's1', workDir: '/w', payload: {}, rawBody: r2 });
    channel.close();

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1), { timeout: 1000 });
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://cloud.example.com/api/hook');
    const body = JSON.parse(opts.body);
    expect(body.action).toBe('forward');
    expect(body.from).toBe('desktop');
    expect(body.data).toEqual([r1, r2]);
    vi.unstubAllGlobals();
  });

  // ============ sendPermissionRequest / abortPermissionRequest ============

  it('sendPermissionRequest 同步 POST 到 /api/hook 并返回 parsed + bodyText', async () => {
    const cloudResponse = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(cloudResponse)),
    });
    vi.stubGlobal('fetch', fetchSpy);
    channel.updateConfig({ enabled: true, url: 'https://cloud.example.com', token: 'tok' });

    const rawBody = { hook_event_name: 'PermissionRequest', session_id: 's1', tool_name: 'bash' };
    const res = await channel.sendPermissionRequest('req-1', rawBody);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://cloud.example.com/api/hook');
    const body = JSON.parse(opts.body);
    expect(body.action).toBe('forward');
    expect(body.from).toBe('desktop');
    expect(body.data).toEqual(rawBody);
    expect(body.request_id).toBe('req-1');

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.parsed).toEqual(cloudResponse);
    expect(res.bodyText).toBe(JSON.stringify(cloudResponse));
    vi.unstubAllGlobals();
  });

  it('sendPermissionRequest 未启用时抛错', async () => {
    await expect(
      channel.sendPermissionRequest('r1', { foo: 1 }),
    ).rejects.toThrow(/not enabled/);
  });

  it('sendPermissionRequest 超时后 reject', async () => {
    // 模拟一个能响应 AbortController 的 fetch
    const fetchSpy = vi.fn().mockImplementation((_url: string, opts: any) => {
      return new Promise((_resolve, reject) => {
        if (opts?.signal) {
          if (opts.signal.aborted) {
            reject(opts.signal.reason ?? new Error('aborted'));
            return;
          }
          opts.signal.addEventListener('abort', () => {
            reject(opts.signal.reason ?? new Error('aborted'));
          });
        }
        // 永不 resolve，靠 abort 取消
      });
    });
    vi.stubGlobal('fetch', fetchSpy);
    channel.updateConfig({ enabled: true, url: 'https://cloud.example.com', token: 'tok' });

    const start = Date.now();
    await expect(
      channel.sendPermissionRequest('r-timeout', { foo: 1 }, 50),
    ).rejects.toThrow(/timeout/);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThan(2000);
    vi.unstubAllGlobals();
  });

  it('abortPermissionRequest POST action=abort + 取消 pending 的 sendPermissionRequest', async () => {
    let resolveFetch: (v: any) => void = () => {};
    const pendingFetch = new Promise((resolve) => { resolveFetch = resolve; });
    const fetchSpy = vi.fn().mockReturnValue(pendingFetch);
    vi.stubGlobal('fetch', fetchSpy);
    channel.updateConfig({ enabled: true, url: 'https://cloud.example.com', token: 'tok' });

    const rawBody = { hook_event_name: 'PermissionRequest', session_id: 's1' };
    const sendP = channel.sendPermissionRequest('r-abort', rawBody, 5000);

    // 等一个 tick 让 fetch 被调用
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 调用 abort
    const abortP = channel.abortPermissionRequest('r-abort', rawBody, 'allow');

    // 让 send 的 fetch 收到结果（被 abort 取消后会被 reject）
    resolveFetch({ ok: true, status: 200, text: () => Promise.resolve('{}') });

    // sendPermissionRequest 应该 reject（被 abort 取消）
    await expect(sendP).rejects.toThrow(/aborted/);
    await abortP;

    // abort 自身也发了一次 fetch（POST action=abort）
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [, abortOpts] = fetchSpy.mock.calls[1];
    const abortBody = JSON.parse(abortOpts.body);
    expect(abortBody.action).toBe('abort');
    expect(abortBody.request_id).toBe('r-abort');
    expect(abortBody.decision).toBe('allow');
    expect(abortBody.data).toEqual(rawBody);
    vi.unstubAllGlobals();
  });

  it('abortPermissionRequest 在未启用时是 no-op', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await channel.abortPermissionRequest('r1', { foo: 1 }, 'deny');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('close 时取消所有 pending permission 请求', async () => {
    let resolveFetch: (v: any) => void = () => {};
    const pendingFetch = new Promise((resolve) => { resolveFetch = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pendingFetch));
    channel.updateConfig({ enabled: true, url: 'https://cloud.example.com', token: 'tok' });

    const sendP = channel.sendPermissionRequest('r-close', { foo: 1 }, 5000);
    await new Promise((r) => setTimeout(r, 10));

    channel.close();
    resolveFetch({ ok: true, status: 200, text: () => Promise.resolve('{}') });
    await expect(sendP).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});
