import { getLogger } from '../log.js';
import type { CheckResult, CloudCheckResponse, UpdateConfig } from './types.js';
import os from 'node:os';

const logger = getLogger();
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

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  body: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

async function checkGitHub(
  _config: UpdateConfig,
  currentVersion: string,
): Promise<CheckResult | null> {
  const [owner, repo] = ['walleliu1016', 'lynel-desktop'];

  try {
    // 用 GitHub API 获取最新 release 信息（无需 latest.yml）
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    logger.info(`[checker] github api: ${apiUrl}`);
    const apiResp = await fetchWithTimeout(apiUrl, TIMEOUT_MS);
    if (!apiResp.ok) throw new Error(`GitHub API ${apiResp.status}`);

    const release: GitHubRelease = await apiResp.json();
    if (!release?.tag_name) throw new Error('tag_name not found in API response');

    // 去掉 v 前缀得到版本号
    const version = release.tag_name.replace(/^v/, '');
    if (version === currentVersion) {
      logger.info(`[checker] github: 已是最新 (${version})`);
      return { hasUpdate: false };
    }

    // 匹配当前平台+架构的下载文件
    const plat = platformParam();
    const arch = os.arch();
    let assetNamePattern: RegExp;
    if (plat === 'win') {
      assetNamePattern = /\.exe$/i;
    } else if (plat === 'mac') {
      assetNamePattern = /\.dmg$/i;
    } else {
      assetNamePattern = /\.AppImage$/i;
    }

    const asset = release.assets.find((a) => assetNamePattern.test(a.name));
    const downloadUrl = asset?.browser_download_url ?? '';

    // 尝试获取 latest.yml 补充 sha512（缺失时不阻塞）
    let sha512 = '';
    try {
      const ymlUrl = `https://github.com/${owner}/${repo}/releases/latest/download/latest.yml`;
      const ymlResp = await fetchWithTimeout(ymlUrl, 5_000);
      if (ymlResp.ok) {
        const text = await ymlResp.text();
        sha512 = /^sha512:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
      }
    } catch {}

    logger.info(`[checker] github: 发现新版本 ${version} asset=${asset?.name ?? '?'}`);
    return {
      hasUpdate: true,
      version,
      releaseDate: release.published_at,
      releaseNotes: release.body ?? '',
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
  const errors: string[] = [];

  if (config.githubEnabled) {
    const result = await checkGitHub(config, currentVersion);
    if (result) return result;
    errors.push('GitHub: API 不可达或无发布版本');
    logger.info('[checker] github 失败，进入 fallback');
  }

  if (config.httpEnabled && config.httpBaseUrl) {
    const result = await checkHttp(config, currentVersion);
    if (result) return result;
    errors.push(`云服务(${config.httpBaseUrl}): 不可达`);
  } else if (!config.httpEnabled || !config.httpBaseUrl) {
    errors.push('云服务: 未配置地址');
  }

  const detail = errors.length > 0 ? errors.join('；') : '无可用更新源';
  logger.error(`[checker] 所有更新源均失败: ${detail}`);
  throw new Error(`检查更新失败：${detail}`);
}
