// tests/main/auth-persistence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeStorage } from 'electron';
import { getStore } from '../../src/main/store.js';
import {
  saveStoredAuth,
  loadStoredAuth,
  clearStoredAuth,
  decideRestore,
  writeCredentialFile,
  clearCredentialFile,
} from '../../src/main/auth-persistence.js';

function tmpCredPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynel-cred-'));
  return path.join(dir, 'credential.json');
}

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
  beforeEach(() => {
    store._data = {};
    vi.clearAllMocks();
    // 恢复默认 mock 实现，防止 test 2 的 mockReturnValue(false) / test 3 的 throw 泄漏到后续用例
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    vi.mocked(safeStorage.decryptString).mockImplementation((b: Buffer) => b.toString('utf8').replace(/^enc:/, ''));
  });

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

  it('writeCredentialFile 明文写入 userId+jwt 供兄弟应用读取', () => {
    const f = tmpCredPath();
    try {
      writeCredentialFile('u1', 'jwt-abc', f);
      expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ userId: 'u1', jwt: 'jwt-abc' });
    } finally {
      fs.rmSync(path.dirname(f), { recursive: true, force: true });
    }
  });

  it('clearCredentialFile 删除且幂等', () => {
    const f = tmpCredPath();
    try {
      writeCredentialFile('u1', 'jwt', f);
      expect(fs.existsSync(f)).toBe(true);
      clearCredentialFile(f);
      expect(fs.existsSync(f)).toBe(false);
      clearCredentialFile(f); // 不存在时再删不抛
      expect(fs.existsSync(f)).toBe(false);
    } finally {
      fs.rmSync(path.dirname(f), { recursive: true, force: true });
    }
  });
});
