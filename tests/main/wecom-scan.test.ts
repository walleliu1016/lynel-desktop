// tests/main/wecom-scan.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const httpsGetMock = vi.hoisted(() => vi.fn());

vi.mock('node:https', () => ({
  default: { get: httpsGetMock },
}));

import {
  fetchQRCode,
  pollOnce,
  getPlatCode,
  startScan,
  cancelScan,
  scanTiming,
} from '../../src/main/wecom-scan.js';

type MockRes = EventEmitter & { statusCode?: number };

/** 单次响应：注册 https.get mock，setImmediate 自动 emit 给定 body（与 mockHttpsSequence 一致） */
function mockHttpsGet(body: string): MockRes {
  const res = new EventEmitter() as MockRes;
  httpsGetMock.mockImplementationOnce((_url: string, cb: (r: any) => void) => {
    cb(res);
    setImmediate(() => { res.emit('data', body); res.emit('end'); });
    return { on: vi.fn() };
  });
  return res;
}

/** 按调用序号返回响应体（最后一个重复），setImmediate 自动 emit，用于轮询集成测试 */
function mockHttpsSequence(bodies: string[]) {
  let i = 0;
  httpsGetMock.mockImplementation((_url: string, cb: (r: any) => void) => {
    const r = new EventEmitter() as any;
    const body = bodies[Math.min(i++, bodies.length - 1)];
    cb(r);
    setImmediate(() => { r.emit('data', body); r.emit('end'); });
    return { on: vi.fn() };
  });
}

describe('getPlatCode', () => {
  it('平台映射 darwin=1 win32=2 linux=3 其他=0', () => {
    expect(getPlatCode('darwin')).toBe(1);
    expect(getPlatCode('win32')).toBe(2);
    expect(getPlatCode('linux')).toBe(3);
    expect(getPlatCode('freebsd')).toBe(0);
  });
});

describe('fetchQRCode', () => {
  beforeEach(() => { httpsGetMock.mockReset(); });

  it('解析 scode 与 authUrl，并按平台传 plat', async () => {
    mockHttpsGet(JSON.stringify({ data: { scode: 's1', auth_url: 'http://qr/abc' } }));
    const r = await fetchQRCode('linux');
    expect(r).toEqual({ scode: 's1', authUrl: 'http://qr/abc' });
    expect(httpsGetMock).toHaveBeenCalledWith(
      expect.stringContaining('source=wecom-cli&plat=3'),
      expect.any(Function),
    );
  });

  it('响应缺 scode/auth_url 时抛错', async () => {
    mockHttpsGet(JSON.stringify({ data: {} }));
    await expect(fetchQRCode('linux')).rejects.toThrow('响应格式异常');
  });
});

describe('pollOnce', () => {
  beforeEach(() => { httpsGetMock.mockReset(); });

  it('success 返回 botid/secret', async () => {
    mockHttpsGet(JSON.stringify({
      data: { status: 'success', bot_info: { botid: 'B1', secret: 'S1' } },
    }));
    await expect(pollOnce('s1')).resolves.toEqual({ botId: 'B1', secret: 'S1' });
  });

  it('非 success 返回 null', async () => {
    mockHttpsGet(JSON.stringify({ data: { status: 'waiting' } }));
    await expect(pollOnce('s1')).resolves.toBeNull();
  });

  it('success 但缺 bot_info 抛错', async () => {
    mockHttpsGet(JSON.stringify({ data: { status: 'success', bot_info: {} } }));
    await expect(pollOnce('s1')).rejects.toThrow('未获取到 Bot 信息');
  });
});

describe('startScan 轮询', () => {
  beforeEach(() => {
    httpsGetMock.mockReset();
    cancelScan();
    scanTiming.intervalMs = 5;
    scanTiming.timeoutMs = 60;
  });

  it('扫码成功返回 scode/authUrl 并推送 pending + success', async () => {
    mockHttpsSequence([
      JSON.stringify({ data: { scode: 's1', auth_url: 'http://qr' } }),
      JSON.stringify({ data: { status: 'success', bot_info: { botid: 'B1', secret: 'S1' } } }),
    ]);
    const events: any[] = [];
    const { scode, authUrl } = await startScan((e) => events.push(e));
    expect(scode).toBe('s1');
    expect(authUrl).toBe('http://qr');
    await vi.waitFor(() => {
      const success = events.find((e) => e.type === 'success');
      expect(success).toEqual({ type: 'success', botId: 'B1', secret: 'S1' });
    });
    expect(events.some((e) => e.type === 'pending')).toBe(true);
  });

  it('扫码未完成时推送 timeout', async () => {
    mockHttpsSequence([
      JSON.stringify({ data: { scode: 's1', auth_url: 'http://qr' } }),
      JSON.stringify({ data: { status: 'waiting' } }),
    ]);
    scanTiming.intervalMs = 2;
    scanTiming.timeoutMs = 15;
    const events: any[] = [];
    await startScan((e) => events.push(e));
    await vi.waitFor(
      () => expect(events.some((e) => e.type === 'timeout')).toBe(true),
      { timeout: 2000 },
    );
  });
});
