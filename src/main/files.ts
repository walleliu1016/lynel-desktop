// 文件服务核心纯函数：忽略清单 / 二进制判定 / 目录列出 / 路径校验
import fs from 'node:fs';
import path from 'node:path';

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
