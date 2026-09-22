// 文件服务核心纯函数：忽略清单 / 二进制判定 / 目录列出 / 路径校验
import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import { getBus } from './events.js';

export const MAX_TEXT_SIZE = 1024 * 1024; // 1MB，超过视为大文件只读

export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.venv', 'venv',
  '__pycache__', '.next', '.cache', 'coverage', '.vscode', '.idea',
]);

export function isIgnored(name: string): boolean {
  if (IGNORED_DIRS.has(name)) return true;
  // 锁文件 package-lock.json 以 .json 结尾，需单独匹配；其余按扩展名忽略
  return /\.(log|lock|min\.js)$|package-lock\.json$/.test(name);
}

export function detectBinary(buf: Buffer): boolean {
  // 采样前 8KB，含 NUL 字节判定二进制
  return buf.subarray(0, 8192).includes(0);
}

export interface FsEntry { name: string; isDir: boolean }

export function listDir(dirPath: string): FsEntry[] {
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => !isIgnored(d.name))
    .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
    .sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
    );
}

/** 把 relPath 安全解析到 workDir 内；相对路径越界抛错，防目录穿越 */
export function resolveEntry(workDir: string, relPath: string): string {
  const base = path.resolve(workDir);
  const target = path.resolve(base, relPath || '.');
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('路径越界');
  }
  return target;
}

/** 读取文件条目：返回文本内容（二进制/超大文件做截断标记） */
export async function readFileEntry(filePath: string): Promise<{ content: string; size: number; binary: boolean; truncated: boolean }> {
  const stat = await fs.promises.stat(filePath);
  const size = stat.size;
  // 只读前 readLen 字节：size > 1MB 时避免整读入内存（>1MB 只读截断）
  const readLen = Math.min(size, MAX_TEXT_SIZE + 1);
  let data = Buffer.alloc(0);
  if (readLen > 0) {
    const buf = Buffer.allocUnsafe(readLen);
    const fh = await fs.promises.open(filePath, 'r');
    let bytesRead = 0;
    try {
      bytesRead = (await fh.read(buf, 0, readLen, 0)).bytesRead;
    } finally {
      await fh.close();
    }
    data = bytesRead === readLen ? buf : buf.subarray(0, bytesRead);
  }
  const binary = detectBinary(data);
  if (binary) return { content: '', size, binary: true, truncated: false };
  if (size > MAX_TEXT_SIZE) {
    return { content: data.subarray(0, MAX_TEXT_SIZE).toString('utf8'), size, binary: false, truncated: true };
  }
  return { content: data.toString('utf8'), size, binary: false, truncated: false };
}

/** 以 utf8 写入文本内容 */
export async function writeFileEntry(filePath: string, content: string): Promise<void> {
  await fs.promises.writeFile(filePath, content, 'utf8');
}

/** 新建文件或目录；文件用 'wx' 防止覆盖已存在 */
export async function createEntry(filePath: string, isDir: boolean): Promise<void> {
  if (isDir) await fs.promises.mkdir(filePath, { recursive: false });
  else await fs.promises.writeFile(filePath, '', { flag: 'wx' }); // 已存在则抛错
}

/** 在 workDir 内重命名/移动条目（oldRel → newRel，均做越界校验） */
export async function renameEntry(workDir: string, oldRel: string, newRel: string): Promise<void> {
  await fs.promises.rename(resolveEntry(workDir, oldRel), resolveEntry(workDir, newRel));
}

/** 删除文件或目录；目录递归删除 */
export async function deleteEntry(filePath: string): Promise<void> {
  const stat = await fs.promises.lstat(filePath);
  if (stat.isDirectory()) await fs.promises.rm(filePath, { recursive: true, force: true });
  else await fs.promises.unlink(filePath);
}

// —— 以下为文件服务 IPC + 目录监听 ——
const watchers = new Map<string, fs.FSWatcher>();
const watcherTimers = new Map<string, NodeJS.Timeout>();

export function registerFilesIpc(): void {
  ipcMain.handle('file:listDir', async (_e, workDir: string, relPath?: string) =>
    listDir(resolveEntry(workDir, relPath || '')));

  ipcMain.handle('file:read', async (_e, workDir: string, relPath: string) =>
    readFileEntry(resolveEntry(workDir, relPath)));

  ipcMain.handle('file:write', async (_e, workDir: string, relPath: string, content: string) => {
    await writeFileEntry(resolveEntry(workDir, relPath), content);
    return { ok: true };
  });

  ipcMain.handle('file:create', async (_e, workDir: string, relPath: string, isDir: boolean) => {
    await createEntry(resolveEntry(workDir, relPath), isDir);
    return { ok: true };
  });

  ipcMain.handle('file:rename', async (_e, workDir: string, oldRel: string, newRel: string) => {
    await renameEntry(workDir, oldRel, newRel);
    return { ok: true };
  });

  ipcMain.handle('file:delete', async (_e, workDir: string, relPath: string) => {
    await deleteEntry(resolveEntry(workDir, relPath));
    return { ok: true };
  });

  ipcMain.handle('file:watch', async (_e, workDir: string) => {
    startWatch(workDir);
    return { ok: true };
  });

  ipcMain.handle('file:unwatch', async (_e, workDir: string) => {
    await stopWatch(workDir);
    return { ok: true };
  });
}

export function startWatch(workDir: string): void {
  if (watchers.has(workDir)) return;
  // 原生 recursive watch（Windows: ReadDirectoryChangesW 树模式 / macOS: FSEvents /
  // Linux: Node>=20.13 inotify 聚合）：整树一个句柄。
  // 不用 chokidar 的原因：它会给树内每个路径各建一个 fs.watch（单仓库实测 ~4000 句柄），
  // 几千个内核 watch 队列叠加 dev 高频写盘会打爆 IOCP（实测主进程 CPU 161% 空转、句柄每秒 +180）。
  let w: fs.FSWatcher;
  try {
    w = fs.watch(workDir, { recursive: true, persistent: true }, (_event, filename) => {
      let rel = '';
      if (filename != null && filename !== '') {
        rel = String(filename).replace(/\\/g, '/');
        // 递归 watch 在内核层无法排除子树（node_modules/.git 的事件仍会投递），
        // 按路径分段跑同一 isIgnored：任一段命中即丢弃，与 chokidar ignored 的子树剪枝等价。
        // filename 为 null 时不做过滤、保守触发（Windows/macOS 均有此情况）。
        if (rel.split('/').some((seg) => isIgnored(seg))) return;
      }
      // 150ms 合帧，避免高频写入打爆 IPC；窗口内只报最后一条 rel（与原实现一致）
      const t = watcherTimers.get(workDir);
      if (t) clearTimeout(t);
      watcherTimers.set(workDir, setTimeout(() => {
        watcherTimers.delete(workDir);
        getBus().emit('file:changed', { workDir, relPath: rel });
      }, 150));
    });
  } catch (err) {
    // 极老运行时（Linux Node<20.13）recursive 同步抛 ERR_FEATURE_UNAVAILABLE_ON_PLATFORM
    console.error('[files:watch]', err);
    return;
  }
  // 监听异步错误（EMFILE/ENOSPC/递归缓冲溢出等），避免走向主进程未捕获异常路径
  w.on('error', (err) => console.error('[files:watch]', err));
  watchers.set(workDir, w);
}

export async function stopWatch(workDir: string): Promise<void> {
  const w = watchers.get(workDir);
  if (w) { w.close(); watchers.delete(workDir); }
  const t = watcherTimers.get(workDir);
  if (t) { clearTimeout(t); watcherTimers.delete(workDir); }
}
