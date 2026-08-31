// src/main/wecom-scan.ts
import https from 'node:https';
import os from 'node:os';

export type ScanEvent =
  | { type: 'pending' }
  | { type: 'success'; botId: string; secret: string }
  | { type: 'timeout' }
  | { type: 'error'; message: string };

export interface ScanStartResult {
  scode: string;
  authUrl: string;
}
export interface ScanBotInfo {
  botId: string;
  secret: string;
}

const QR_GENERATE_URL = 'https://work.weixin.qq.com/ai/qc/generate';
const QR_QUERY_URL = 'https://work.weixin.qq.com/ai/qc/query_result';
/** 轮询与超时参数，测试中可缩短 */
export const scanTiming = { intervalMs: 3000, timeoutMs: 300000 };

let active = false;
/** 扫描代际计数：每次 startScan / cancelScan 自增，用于隔离并发轮询循环 */
let scanGen = 0;
/** 轮询错误标记：statusCode = HTTP 非 2xx；terminal = 扫码成功的业务错误 */
type PollError = Error & { statusCode?: number; terminal?: boolean };

/** 平台码：darwin=1、win32=2、linux=3、其他=0 */
export function getPlatCode(platform: NodeJS.Platform = os.platform()): number {
  switch (platform) {
    case 'darwin': return 1;
    case 'win32': return 2;
    case 'linux': return 3;
    default: return 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        // 非 2xx 视为终端失败：不收集 body，带 statusCode 属性 reject，
        // 由调用方区分「HTTP 错误」与「网络瞬断」。
        if (res.statusCode && res.statusCode >= 400) {
          const err = new Error(`请求失败：HTTP ${res.statusCode}`) as PollError;
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

/** 请求二维码链接，返回 scode 与 auth_url */
export async function fetchQRCode(
  platform: NodeJS.Platform = os.platform(),
): Promise<ScanStartResult> {
  const url = `${QR_GENERATE_URL}?source=wecom-cli&plat=${getPlatCode(platform)}`;
  const raw = await httpsGet(url);
  const resp = JSON.parse(raw);
  if (!resp?.data?.scode || !resp?.data?.auth_url) {
    throw new Error('获取二维码失败，响应格式异常');
  }
  return { scode: resp.data.scode, authUrl: resp.data.auth_url };
}

/** 单次查询扫码结果；success 返回凭据，其余返回 null */
export async function pollOnce(scode: string): Promise<ScanBotInfo | null> {
  const url = `${QR_QUERY_URL}?scode=${encodeURIComponent(scode)}`;
  const raw = await httpsGet(url);
  const resp = JSON.parse(raw);
  if (resp?.data?.status === 'success') {
    const botInfo = resp.data.bot_info;
    if (!botInfo?.botid || !botInfo?.secret) {
      // 扫码已成功的业务错误：继续等没有意义，标记 terminal 供轮询终止
      const err = new Error('扫码成功但未获取到 Bot 信息') as PollError;
      err.terminal = true;
      throw err;
    }
    return { botId: botInfo.botid, secret: botInfo.secret };
  }
  return null;
}

/** 发起扫码：获取二维码并启动轮询；返回 scode/authUrl 供渲染二维码 */
export function startScan(onEvent: (e: ScanEvent) => void): Promise<ScanStartResult> {
  cancelScan();
  const gen = ++scanGen;
  return fetchQRCode().then(({ scode, authUrl }) => {
    active = true;
    onEvent({ type: 'pending' });
    void runPollLoop(scode, gen, onEvent, Date.now() + scanTiming.timeoutMs);
    return { scode, authUrl };
  });
}

async function runPollLoop(scode: string, gen: number, onEvent: (e: ScanEvent) => void, deadline: number) {
  while (gen === scanGen && active) {
    try {
      const info = await pollOnce(scode);
      if (gen !== scanGen) break;
      if (info) {
        active = false;
        onEvent({ type: 'success', botId: info.botId, secret: info.secret });
        return;
      }
    } catch (e) {
      const err = e as PollError;
      if (err.statusCode !== undefined || err.terminal) {
        // 终端失败（HTTP 非 2xx / 扫码成功的业务错误）：继续等没有意义，终止轮询
        if (gen !== scanGen) break; // 旧代已过期：不 push error、不清 active（见下方收尾说明）
        active = false;
        onEvent({ type: 'error', message: err.message });
        return;
      }
      // 网络瞬断（DNS/TLS/ECONNRESET 等）：忽略本次，继续轮询直到超时
    }
    if (gen !== scanGen) break;
    if (Date.now() >= deadline) {
      active = false;
      onEvent({ type: 'timeout' });
      return;
    }
    await sleep(scanTiming.intervalMs);
  }
  // 统一收尾：仅当本代仍是 owner 才清 active。
  // 不能无条件置 active=false —— 若 scan#2 已 active=true 后 scan#1 的旧循环
  // 在 gen-mismatch 处退出时清掉 active，会把 scan#2 的轮询循环打死。
  // 只有当前代（gen === scanGen）退出时才补置 false，保持「active ⇔ 有本代循环在跑」。
  if (gen === scanGen) active = false;
}

export function cancelScan(): void {
  active = false;
  scanGen++;
}
