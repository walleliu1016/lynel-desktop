import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 强制 require('electron-log/main') 和 require('electron') 抛错，
// 触发 log.ts 的 console fallback 路径，验证 scope 不再无限递归。
describe('log fallback console', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('scope 链式调用不爆栈，transports 访问安全', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: any) => { out.push(String(chunk)); return true; }) as any;
    process.stderr.write = ((chunk: any) => { err.push(String(chunk)); return true; }) as any;

    // 劫持 require，模拟 electron binary 不可用
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Module = require('module');
    const origReq = Module.prototype.require;
    Module.prototype.require = function (id: string) {
      if (id === 'electron-log/main' || id === 'electron') {
        throw new Error('simulated unavailable');
      }
      return origReq.call(this, id);
    };

    try {
      const { getLogger } = await import('../../src/main/log.js');
      const log = getLogger();

      log.info('plain info');
      log.error('plain error');
      expect(out.some((s) => s.includes('plain info'))).toBe(true);
      expect(err.some((s) => s.includes('plain error'))).toBe(true);

      // scope 关键测试：之前是无限递归
      const scoped = log.scope('app');
      scoped.info('scoped info');
      scoped.error('scoped error');
      expect(out.some((s) => s.includes('[app]') && s.includes('scoped info'))).toBe(true);
      expect(err.some((s) => s.includes('[app]') && s.includes('scoped error'))).toBe(true);

      // 嵌套 scope
      const nested = scoped.scope('nested');
      nested.warn('nested warn');
      expect(out.some((s) => s.includes('[nested]') && s.includes('nested warn'))).toBe(true);

      // transports no-op
      (log.transports as any).file.level = 'info';
      expect((log.transports as any).file.level).toBe('info');
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      Module.prototype.require = origReq;
    }
  });
});
