import { describe, it, expect, vi } from 'vitest';

/**
 * dsh 鉴权 cookie 解析回归测试。
 *
 * 背景：新版 dsh web 需要鉴权，就绪地址带 `?token=`，用该地址访问会 303 并下发
 * `Set-Cookie: dsh-auth-<hash>=…; HttpOnly; SameSite=Strict`。harness 跑在 iframe 的
 * 跨站上下文里，这个 SameSite 属性会让 cookie 存不下，所以 Lynel 要解析出 name/value
 * 后按 SameSite=None 重新写入会话。
 */

// dsh-cookie 顶层 import electron 的 session；测试环境没有 Electron runtime
vi.mock('electron', () => ({
  session: {
    defaultSession: {
      cookies: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    },
  },
}));

import { parseSetCookie } from '../../src/main/dsh-cookie.js';

describe('parseSetCookie', () => {
  it('解析真实 dsh 会话 cookie（含 Max-Age / Expires / HttpOnly / SameSite）', () => {
    const raw =
      'dsh-auth-3tmcrkJgbcXdW9tz1kK8IQxyYUTkInDCG90N-89RCow=v1.eyJ2ZXJzaW9uIjoxfQ.1QnXTh';
    const full = `${raw}; Max-Age=2592000; Path=/; Expires=Sat, 17 Oct 2026 11:27:13 GMT; HttpOnly; SameSite=Strict`;
    expect(parseSetCookie(full)).toEqual({
      name: 'dsh-auth-3tmcrkJgbcXdW9tz1kK8IQxyYUTkInDCG90N-89RCow',
      value: 'v1.eyJ2ZXJzaW9uIjoxfQ.1QnXTh',
      maxAgeSeconds: 2592000,
    });
  });

  it('没有 Max-Age 时返回 0（调用方不设过期时间）', () => {
    expect(parseSetCookie('a=b; Path=/')).toEqual({ name: 'a', value: 'b', maxAgeSeconds: 0 });
  });

  it('值里含 = 时按第一个 = 切分', () => {
    expect(parseSetCookie('a=v1.sig==; Path=/')?.value).toBe('v1.sig==');
  });

  it('Max-Age 非法时退化为 0，而不是 NaN', () => {
    expect(parseSetCookie('a=b; Max-Age=abc')?.maxAgeSeconds).toBe(0);
  });

  it('非法输入返回 null', () => {
    expect(parseSetCookie('not-a-cookie')).toBeNull();
    expect(parseSetCookie('')).toBeNull();
  });
});
