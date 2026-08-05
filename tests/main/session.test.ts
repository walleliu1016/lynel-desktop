import { describe, it, expect } from 'vitest';
import { newSession, register, lookup, send, rebind } from '../../src/main/session.js';

describe('session', () => {
  it('registers and lookups session', () => {
    const s = newSession('s1', '/wd');
    register(s);
    expect(lookup('s1')?.workDir).toBe('/wd');
  });

  it('send normalizes prompt with carriage return', () => {
    const s = newSession('s2', '/wd');
    register(s);
    let written = '';
    s.process = {
      write: (d: string) => { written = d; },
    } as any;
    send('s2', 'hello');
    expect(written).toBe('hello\r');
  });

  it('send does not duplicate trailing newline', () => {
    const s = newSession('s3', '/wd');
    register(s);
    let written = '';
    s.process = {
      write: (d: string) => { written = d; },
    } as any;
    send('s3', 'hello\n');
    expect(written).toBe('hello\n');
  });
});

describe('session rebind (/clear 迁移)', () => {
  it('migrates session key without killing process', () => {
    const s = newSession('old', '/wd');
    let written = '';
    s.process = { write: (d: string) => { written = d; } } as any;
    register(s);
    const migrated = rebind('old', 'new', '/wd2');
    expect(migrated?.id).toBe('new');
    expect(migrated?.workDir).toBe('/wd2');
    expect(migrated?.process).toBe(s.process); // 进程引用保留，不 kill
    expect(lookup('old')).toBeUndefined();      // 旧 key 已移除
    expect(lookup('new')?.process).toBe(s.process);
    // 迁移后向新 id 发送仍能写入同一进程
    send('new', 'hi');
    expect(written).toBe('hi\r');
  });

  it('returns undefined for missing session', () => {
    expect(rebind('ghost', 'new', '/wd')).toBeUndefined();
  });
});
