// tests/main/channels/desktop-socket.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesktopSocket } from '../../../src/main/channels/desktop-socket.js';

function makeSocket(): DesktopSocket {
  const ds = new DesktopSocket();
  (ds as any).url = 'https://cloud.example.com';
  (ds as any).enabled = true;
  return ds;
}

describe('DesktopSocket restoreToken / token-first auth', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('restoreToken 设置 userId+token，getToken 可读回', () => {
    const ds = makeSocket();
    ds.restoreToken('u1', 'jwt-abc');
    expect(ds.getToken()).toBe('jwt-abc');
    expect((ds as any).userId).toBe('u1');
  });

  it('有 token 时 ensureJwtAndAuth 直接 emit desktop:auth，不调 login', async () => {
    const ds = makeSocket();
    ds.restoreToken('u1', 'jwt-abc');
    const emitSpy = vi.fn();
    (ds as any).socket = { connected: true, emit: emitSpy };
    const loginSpy = vi.spyOn(ds as any, 'login').mockResolvedValue({ token: 'never' });
    await (ds as any).ensureJwtAndAuth();
    expect(loginSpy).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith('desktop:auth', {
      user_id: 'u1',
      token: 'jwt-abc',
      machine_name: expect.any(String),
    });
  });

  it('无 token 有密码时走 login 换 token 再 emit', async () => {
    const ds = makeSocket();
    (ds as any).password = 'pw';
    const emitSpy = vi.fn();
    (ds as any).socket = { connected: true, emit: emitSpy };
    vi.spyOn(ds as any, 'login').mockResolvedValue({ token: 'new-token' });
    await (ds as any).ensureJwtAndAuth();
    expect(emitSpy).toHaveBeenCalledWith('desktop:auth', expect.objectContaining({ token: 'new-token' }));
  });

  it('无 token 无密码时 ensureJwtAndAuth 告警返回，不 emit 不调 login', async () => {
    const ds = makeSocket();
    const emitSpy = vi.fn();
    (ds as any).socket = { connected: true, emit: emitSpy };
    const loginSpy = vi.spyOn(ds as any, 'login').mockResolvedValue({ token: 'never' });
    await (ds as any).ensureJwtAndAuth();
    expect(loginSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
