/**
 * 把 dsh web 的会话 cookie 装进 Electron 的会话，让 harness 能在 iframe 里正常加载。
 *
 * 背景：新版 dsh 的 web 服务需要鉴权 —— 启动时打印带 `?token=` 的地址，用该地址访问
 * 会 303 到 `/` 并下发 `Set-Cookie: dsh-auth-<hash>=…; HttpOnly; SameSite=Strict`。
 * 但 harness 是在 Lynel 页面的 iframe 里加载的（跨站上下文），SameSite=Strict 的 cookie
 * 既存不下也发不出去，页面只会停在 "dsh web authentication required"。
 *
 * 这里主动用 token 换一次 cookie，再用 Electron 的 session API 以 SameSite=None 写入
 * （127.0.0.1 属于可信来源，允许 secure cookie），后续 iframe 的请求就能带上了。
 */
import { session } from 'electron';
import http from 'node:http';
import { getLogger } from './log.js';

/** dsh 下发的 cookie 名前缀（见 dsh-client-connection 的 COOKIE_PREFIX） */
const COOKIE_PREFIX = 'dsh-auth-';

export interface ParsedCookie {
  name: string;
  value: string;
  /** Max-Age 秒数；没有该属性时为 0 */
  maxAgeSeconds: number;
}

/**
 * 解析 `Set-Cookie` 首条：只取 name / value / Max-Age，其余属性（HttpOnly、SameSite、
 * Expires）由调用方按需覆盖 —— 原样照搬 SameSite=Strict 正是要修的问题。
 */
export function parseSetCookie(raw: string): ParsedCookie | null {
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  const pair = parts.shift();
  if (!pair) return null;
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const maxAgeAttr = parts.find((a) => a.toLowerCase().startsWith('max-age='));
  const maxAgeSeconds = maxAgeAttr ? Number(maxAgeAttr.split('=')[1]) : 0;
  return {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    maxAgeSeconds: Number.isFinite(maxAgeSeconds) ? maxAgeSeconds : 0,
  };
}

/** 请求带 token 的地址，拿到 303 响应里的 Set-Cookie（不跟随重定向）。 */
function fetchSessionCookie(rawUrl: string): Promise<{ cookie: string | null; status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.get(rawUrl, (res) => {
      res.resume(); // 响应体无用，读完释放
      const setCookie = res.headers['set-cookie'];
      resolve({ cookie: setCookie?.[0] ?? null, status: res.statusCode ?? 0 });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('请求 dsh 会话 cookie 超时'));
    });
  });
}

/**
 * 用 harness 就绪地址换 cookie 并写入默认会话。
 * 调用方（app.ts）把它注册成 dshManager.onReady 回调。
 */
export async function installHarnessCookie(handleUrl: string): Promise<void> {
  const { cookie: raw, status } = await fetchSessionCookie(handleUrl);
  if (!raw) throw new Error(`未取到 dsh 会话 cookie（status ${status}）`);

  const parsed = parseSetCookie(raw);
  if (!parsed) throw new Error(`dsh 会话 cookie 格式无法解析: ${raw}`);

  const origin = new URL(handleUrl).origin;
  const cookies = session.defaultSession.cookies;

  // cookie 不区分端口，而每次启动的 cookie 名带着新端口的哈希 —— 不清掉旧的会一直堆积
  const existing = await cookies.get({ url: origin });
  await Promise.all(
    existing
      .filter((c) => c.name.startsWith(COOKIE_PREFIX) && c.name !== parsed.name)
      .map((c) => cookies.remove(origin + '/', c.name).catch(() => undefined)),
  );

  await cookies.set({
    url: origin + '/',
    name: parsed.name,
    value: parsed.value,
    path: '/',
    httpOnly: true,
    // 127.0.0.1 是可信来源，允许 secure cookie 走 http；
    // SameSite=None 必须搭配 secure，否则 Chromium 直接拒收
    secure: true,
    sameSite: 'no_restriction',
    ...(parsed.maxAgeSeconds > 0
      ? { expirationDate: Math.floor(Date.now() / 1000) + parsed.maxAgeSeconds }
      : {}),
  });

  getLogger().info(`[dsh] 已注入 harness 鉴权 cookie（${parsed.name}）`);
}
