import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DesktopSocket } from '../../../src/main/channels/desktop-socket.js';

// mock socket.io-client：io() 返回当前 fakeSocket（每个测试新建，隔离 emit/handler 状态）
let fakeSocket: any;
const emittedCalls: { event: string; data: unknown }[] = [];
const handlers: Record<string, ((...args: any[]) => void)[]> = {};

function createFakeSocket() {
  emittedCalls.length = 0;
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  return {
    connected: true,
    emit: (event: string, data: unknown) => {
      emittedCalls.push({ event, data });
      return fakeSocket;
    },
    on: (event: string, cb: (...args: any[]) => void) => {
      (handlers[event] ??= []).push(cb);
      return fakeSocket;
    },
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    io: { on: vi.fn(), emit: vi.fn() },
  };
}

vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));

function triggerSocketEvent(event: string, ...args: unknown[]): void {
  handlers[event]?.forEach((cb) => cb(...args));
}

describe('DesktopSocket', () => {
  let channel: DesktopSocket;
  const url = 'https://cloud.example.com';

  beforeEach(() => {
    fakeSocket = createFakeSocket();
    channel = new DesktopSocket();
  });

  afterEach(() => {
    channel.close();
    vi.unstubAllGlobals();
  });

  it('默认禁用，syncSessions 不创建 socket 也不 emit', async () => {
    await channel.syncSessions([{ session_id: 's1', status: 'open' }]);
    expect(emittedCalls).toHaveLength(0);
  });

  it('updateConfig 启用后 syncSessions 自动填充 machine_name', async () => {
    channel.updateConfig({ enabled: true, url, machineName: 'MACH-A' });
    // 认证成功后 emit 才不会被丢弃
    triggerSocketEvent('auth:success', { user_id: 'u', machine_name: 'MACH-A' });
    await channel.syncSessions([{ session_id: 's1', status: 'open' }]);
    const call = emittedCalls.find((c) => c.event === 'desktop:session:sync');
    expect(call?.data).toEqual({
      sessions: [{ session_id: 's1', status: 'open', machine_name: 'MACH-A' }],
    });
  });

  it('syncSessions 不覆盖调用方显式传入的 machine_name', async () => {
    channel.updateConfig({ enabled: true, url, machineName: 'MACH-A' });
    triggerSocketEvent('auth:success', { user_id: 'u', machine_name: 'MACH-A' });
    await channel.syncSessions([{ session_id: 's1', status: 'open', machine_name: 'MACH-B' }]);
    const call = emittedCalls.find((c) => c.event === 'desktop:session:sync');
    expect((call?.data as { sessions: unknown[] }).sessions[0]).toMatchObject({ machine_name: 'MACH-B' });
  });

  it('auth:success 触发 onSessionSnapshot 回调', () => {
    const onSnapshot = vi.fn();
    channel.onSessionSnapshot = onSnapshot;
    channel.updateConfig({ enabled: true, url, machineName: 'MACH-A' });
    triggerSocketEvent('auth:success', { user_id: 'u', machine_name: 'MACH-A' });
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('desktop:auth payload 携带 machine_name', async () => {
    // mock /api/auth/login 返回 token
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, token: 'tok-1' }),
      }),
    );
    channel.setPassword('pw');
    channel.updateConfig({ enabled: true, url, machineName: 'MACH-A' });
    triggerSocketEvent('connect');
    // login 是异步的，等 fetch 微任务落定
    await new Promise((r) => setTimeout(r, 0));
    const call = emittedCalls.find((c) => c.event === 'desktop:auth');
    expect(call?.data).toMatchObject({ user_id: '', machine_name: 'MACH-A', token: 'tok-1' });
  });
});
