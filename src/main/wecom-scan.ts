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

/** 平台码：darwin=1、win32=2、linux=3、其他=0 */
export function getPlatCode(platform: NodeJS.Platform = os.platform()): number {
  switch (platform) {
    case 'darwin': return 1;
    case 'win32': return 2;
    case 'linux': return 3;
    default: return 0;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
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
      throw new Error('扫码成功但未获取到 Bot 信息');
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
  while (active) {
    if (gen !== scanGen) return;
    try {
      const info = await pollOnce(scode);
      if (gen !== scanGen) return;
      if (info) {
        active = false;
        onEvent({ type: 'success', botId: info.botId, secret: info.secret });
        return;
      }
    } catch {
      // 单次请求网络抖动：忽略，继续轮询
    }
    if (gen !== scanGen) return;
    if (Date.now() >= deadline) {
      active = false;
      onEvent({ type: 'timeout' });
      return;
    }
    await sleep(scanTiming.intervalMs);
  }
}

export function cancelScan(): void {
  active = false;
  scanGen++;
}
