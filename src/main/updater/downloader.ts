import { getLogger } from '../log.js';
import type { CheckResult, UpdateState } from './types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { spawn } from 'node:child_process';

// 自研下载：直接基于 Node https/http 拉取 downloadUrl（GitHub release asset 的完整 HTTPS URL）。
// 不依赖 electron-updater：
//   - 其 generic provider 读 latest.yml 时用 Electron 的 net.ClientRequest，只支持 http/https，
//     无法读 file:// 协议（否则抛 "ClientRequest only supports http: and https: protocols"）。
//   - 其 resolveFiles 硬性要求 sha512，而 GitHub release 未上传 latest.yml 时 sha512 恒为空。
const logger = getLogger();

// 已下载的安装包绝对路径，供 quitAndInstall / 打开所在文件夹使用
let downloadedFilePath: string | null = null;

/** 已下载安装包绝对路径（供"打开所在文件夹"等 UI 使用） */
export function getDownloadedFilePath(): string | null {
  return downloadedFilePath;
}

function downloadTargetPath(version?: string): string {
  const ext =
    process.platform === 'win32' ? '.exe'
    : process.platform === 'darwin' ? '.dmg'
    : '.AppImage';
  const name = version ? `lynel-desktop-${version}` : 'lynel-desktop-update';
  // 保存到用户 Downloads 目录（而非系统 tmp），便于用户找到安装包自行安装
  const dir = path.join(os.homedir(), 'Downloads');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  // 重名时追加序号 (1)/(2)...，不覆盖已有文件
  let target = path.join(dir, `${name}${ext}`);
  for (let i = 1; fs.existsSync(target); i++) {
    target = path.join(dir, `${name} (${i})${ext}`);
  }
  return target;
}

export function downloadUpdate(
  info: CheckResult,
  onProgress: (state: UpdateState) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = info.downloadUrl;
    if (!url) {
      reject(new Error('缺少下载地址，请先检查更新'));
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`下载地址无效: ${url}`));
      return;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      reject(new Error(`不支持的下载协议: ${parsed.protocol}`));
      return;
    }

    // downloadTargetPath 保证文件名唯一（重名自动加序号），无需预先清理
    const target = downloadTargetPath(info.version);
    const fileStream = fs.createWriteStream(target);
    const transport = parsed.protocol === 'https:' ? https : http;

    // 先发 0% 事件，让 UI 立即有"正在下载"反馈（连接建立前可能耗时数秒）
    onProgress({ status: 'downloading', data: { version: info.version, percent: 0, speed: 0 } });

    const req = transport.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        req.destroy();
        try { fs.rmSync(target, { force: true }); } catch {}
        reject(new Error(`下载失败：HTTP ${status}`));
        return;
      }
      // 优先取 content-length（重定向到实际对象存储后会带真实大小），其次 info.size
      const total = Number(res.headers['content-length']) || info.size || 0;
      let received = 0;
      let lastReport = 0;

      res.on('data', (chunk) => {
        received += chunk.length;
        // 写入文件（此前漏写导致下载文件恒为空）
        fileStream.write(chunk);
        // 限制 onProgress 频率，避免高频 IPC
        if (received - lastReport < 256 * 1024) return;
        lastReport = received;
        onProgress({
          status: 'downloading',
          data: {
            version: info.version,
            percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
            speed: 0,
          },
        });
      });

      res.on('end', () => {
        // 等所有 chunk 落盘并关闭句柄后再标记完成，否则文件恒为空、句柄泄漏导致下次 EPERM
        fileStream.end(() => {
          downloadedFilePath = target;
          logger.info(`[downloader] 下载完成: ${info.version} -> ${target}`);
          onProgress({ status: 'downloaded', data: { version: info.version, filePath: target } });
          resolve();
        });
      });

      res.on('error', (err) => {
        fileStream.destroy();
        try { fs.rmSync(target, { force: true }); } catch {}
        reject(err);
      });
    });

    req.on('error', (err) => {
      fileStream.destroy();
      try { fs.rmSync(target, { force: true }); } catch {}
      reject(err);
    });

    fileStream.on('error', (err) => {
      req.destroy();
      reject(err);
    });

    // 连接/响应长时间无进展时主动超时，避免 UI 一直停留在"正在下载 0%"无任何反馈
    req.setTimeout(30_000, () => {
      req.destroy(new Error('下载连接超时，请检查网络后重试'));
    });
  });
}

export function quitAndInstall(): void {
  const file = downloadedFilePath;
  if (!file || !fs.existsSync(file)) {
    logger.warn('[downloader] 未找到已下载的安装包，无法安装');
    return;
  }
  try {
    if (process.platform === 'win32') {
      // NSIS 安装器：/S 静默安装，默认安装目录；安装器会接管并退出旧进程
      spawn(file, ['/S'], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      // dmg：打开后由用户拖入 Applications
      spawn('open', [file], { detached: true, stdio: 'ignore' }).unref();
    } else {
      // Linux AppImage：赋予执行权限并启动
      fs.chmodSync(file, 0o755);
      spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err: any) {
    logger.error(`[downloader] 启动安装失败: ${err?.message ?? err}`);
    return;
  }
  downloadedFilePath = null;
}
