// 文件服务核心纯函数：忽略清单 / 二进制判定 / 目录列出 / 路径校验
import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
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
  const buf = await fs.promises.readFile(filePath);
  const binary = detectBinary(buf);
  if (binary) return { content: '', size, binary: true, truncated: false };
  if (size > MAX_TEXT_SIZE) {
    return { content: buf.subarray(0, MAX_TEXT_SIZE).toString('utf8'), size, binary: false, truncated: true };
  }
  return { content: buf.toString('utf8'), size, binary: false, truncated: false };
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

// —— 以下为文件服务 IPC + chokidar 监听 ——
const watchers = new Map<string, FSWatcher>();
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

function startWatch(workDir: string): void {
  if (watchers.has(workDir)) return;
  const w = chokidar.watch(workDir, {
    ignoreInitial: true,
    ignored: (p: string) => isIgnored(path.basename(p)),
  });
  w.on('all', (_event, p: string) => {
    const rel = path.relative(workDir, p).replace(/\\/g, '/');
    // 150ms 合帧，避免高频写入打爆 IPC
    const t = watcherTimers.get(workDir);
    if (t) clearTimeout(t);
    watcherTimers.set(workDir, setTimeout(() => {
      getBus().emit('file:changed', { workDir, relPath: rel });
    }, 150));
  });
  watchers.set(workDir, w);
}

async function stopWatch(workDir: string): Promise<void> {
  const w = watchers.get(workDir);
  if (w) { await w.close(); watchers.delete(workDir); }
  const t = watcherTimers.get(workDir);
  if (t) { clearTimeout(t); watcherTimers.delete(workDir); }
}
