// tests/main/auth-persistence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeStorage } from 'electron';
import { getStore } from '../../src/main/store.js';
import {
  saveStoredAuth,
  loadStoredAuth,
  clearStoredAuth,
  decideRestore,
} from '../../src/main/auth-persistence.js';

const store = vi.hoisted(() => ({
  _data: {} as Record<string, unknown>,
  get(key: string) { return (this as any)._data[key]; },
  set(key: string, val: unknown) { (this as any)._data[key] = val; },
  delete(key: string) { delete (this as any)._data[key]; },
  get store() { return (this as any)._data; },
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString('utf8').replace(/^enc:/, '')),
  },
}));

vi.mock('../../src/main/store.js', () => ({ getStore: () => store }));

describe('auth-persistence', () => {
  beforeEach(() => { store._data = {}; vi.clearAllMocks(); });

  it('保存后可解密取回', () => {
    expect(saveStoredAuth('u1', 'jwt-abc')).toBe(true);
    expect(loadStoredAuth()).toEqual({ userId: 'u1', jwt: 'jwt-abc' });
  });

  it('加密不可用时不持久化且返回 false', () => {
    (safeStorage.isEncryptionAvailable as any).mockReturnValue(false);
    expect(saveStoredAuth('u1', 'jwt')).toBe(false);
    expect(loadStoredAuth()).toBeNull();
  });

  it('解密失败时清理并返回 null', () => {
    saveStoredAuth('u1', 'jwt-abc');
    (safeStorage.decryptString as any).mockImplementation(() => { throw new Error('decrypt failed'); });
    expect(loadStoredAuth()).toBeNull();
    expect(store.get('auth_jwt_enc')).toBeUndefined();
  });

  it('currentUser 缺失时清理并返回 null', () => {
    saveStoredAuth('u1', 'jwt-abc');
    store.delete('currentUser');
    expect(loadStoredAuth()).toBeNull();
    expect(store.get('auth_jwt_enc')).toBeUndefined();
  });

  it('clearStoredAuth 删除 JWT', () => {
    saveStoredAuth('u1', 'jwt-abc');
    clearStoredAuth();
    expect(loadStoredAuth()).toBeNull();
  });

  it('decideRestore 三分支', () => {
    expect(decideRestore(false, false, 'u1')).toBe('home');
    expect(decideRestore(false, true, 'u1')).toBe('home');
    expect(decideRestore(true, true, 'u1')).toBe('pending');
    expect(decideRestore(true, false, 'u1')).toBe('form');
    expect(decideRestore(false, false, '')).toBe('form');
  });
});
