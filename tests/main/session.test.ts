import { describe, it, expect } from 'vitest';
import { newSession, register, lookup, send } from '../../src/main/session.js';

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
