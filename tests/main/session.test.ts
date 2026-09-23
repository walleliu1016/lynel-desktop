import { describe, it, expect, vi } from 'vitest';
import { newSession, register, lookup, send, sendSafe, rebind, remove, setOnRemove } from '../../src/main/session.js';

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

  it('sendSafe writes text then delayed carriage return', () => {
    vi.useFakeTimers();
    const s = newSession('s4', '/wd');
    register(s);
    const writes: string[] = [];
    s.process = {
      write: (d: string) => { writes.push(d); },
    } as any;
    sendSafe('s4', 'hello');
    expect(writes).toEqual(['hello']);
    vi.advanceTimersByTime(300);
    expect(writes).toEqual(['hello', '\r']);
    vi.useRealTimers();
  });

  it('sendSafe keeps trailing newline as single write', () => {
    const s = newSession('s5', '/wd');
    register(s);
    let written = '';
    s.process = {
      write: (d: string) => { written = d; },
    } as any;
    sendSafe('s5', 'hello\n');
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

describe('session remove（删除会话的清理链）', () => {
  it('remove 触发 onRemove 回调并从注册表删除', () => {
    const cb = vi.fn();
    setOnRemove(cb);
    const s = newSession('rm-1', '/wd');
    register(s);
    expect(lookup('rm-1')).toBeDefined();

    remove('rm-1');
    // onRemove 是清理链的唯一入口（clearSessionMappings + ptyOutBatcher + closeShell），
    // 回调必须被触发，否则残留死会话指针
    expect(cb).toHaveBeenCalledWith('rm-1');
    expect(lookup('rm-1')).toBeUndefined();

    setOnRemove(null as any); // 还原，避免泄漏到其他用例
  });

  it('remove 不存在的 id 不抛异常', () => {
    expect(() => remove('never-existed')).not.toThrow();
  });
});
