import { getLogger } from '../log.js';
import type { CheckResult, CloudCheckResponse, UpdateConfig } from './types.js';
import os from 'node:os';

const logger = getLogger('updater:checker');
const TIMEOUT_MS = 10_000;

function platformParam(): string {
  switch (process.platform) {
    case 'win32': return 'win';
    case 'darwin': return 'mac';
    case 'linux': return 'linux';
    default: return process.platform;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

async function checkGitHub(
  _config: UpdateConfig,
  currentVersion: string,
): Promise<CheckResult | null> {
  const [owner, repo] = ['akke', 'lynel-desktop'];
  const ymlUrl = `https://github.com/${owner}/${repo}/releases/latest/download/latest.yml`;

  try {
    logger.info(`[checker] github check: ${ymlUrl}`);
    const resp = await fetchWithTimeout(ymlUrl, TIMEOUT_MS);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();

    const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim();
    const releaseDate = /^releaseDate:\s*(.+)$/m.exec(text)?.[1]?.trim();

    if (!version) throw new Error('version not found in latest.yml');

    if (version === currentVersion) {
      logger.info(`[checker] github: 已是最新 (${version})`);
      return { hasUpdate: false };
    }

    const pathLine = /^path:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
    const sha512 = /^sha512:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
    const downloadUrl = `https://github.com/${owner}/${repo}/releases/latest/download/${pathLine}`;

    logger.info(`[checker] github: 发现新版本 ${version}`);
    return {
      hasUpdate: true,
      version,
      releaseDate: releaseDate ?? new Date().toISOString(),
      releaseNotes: '',
      forceUpdate: false,
      downloadUrl,
      sha512,
      size: 0,
    };
  } catch (err: any) {
    logger.warn(`[checker] github check failed: ${err?.message ?? err}`);
    return null;
  }
}

async function checkHttp(config: UpdateConfig, currentVersion: string): Promise<CheckResult | null> {
  const platform = platformParam();
  const arch = os.arch();
  const url = `${config.httpBaseUrl}/api/update/check?platform=${platform}&arch=${arch}&version=${currentVersion}&channel=${config.channel}`;

  try {
    logger.info(`[checker] http check: ${url}`);
    const resp = await fetchWithTimeout(url, TIMEOUT_MS);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const body: CloudCheckResponse = await resp.json();
    if (!body.hasUpdate) {
      logger.info('[checker] http: 已是最新');
      return { hasUpdate: false };
    }

    logger.info(`[checker] http: 发现新版本 ${body.version}`);
    return {
      hasUpdate: true,
      version: body.version,
      releaseDate: body.releaseDate,
      releaseNotes: body.releaseNotes,
      forceUpdate: body.forceUpdate ?? false,
      downloadUrl: body.downloadUrl,
      sha512: body.sha512,
      size: body.size,
    };
  } catch (err: any) {
    logger.warn(`[checker] http check failed: ${err?.message ?? err}`);
    return null;
  }
}

export async function checkForUpdates(
  config: UpdateConfig,
  currentVersion: string,
): Promise<CheckResult> {
  if (config.githubEnabled) {
    const result = await checkGitHub(config, currentVersion);
    if (result) return result;
    logger.info('[checker] github 失败，进入 fallback');
  }

  if (config.httpEnabled && config.httpBaseUrl) {
    const result = await checkHttp(config, currentVersion);
    if (result) return result;
  }

  throw new Error('检查更新失败，请检查网络');
}
