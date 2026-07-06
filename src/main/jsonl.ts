import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chokidar from 'chokidar';

export interface SessionMeta {
  id: string;
  workDir: string;
  path: string;
  updatedAt: number;
}

let rootDir = path.join(os.homedir(), '.claude', 'projects');

export function setRoot(dir: string): void {
  rootDir = dir;
}

export function getRoot(): string {
  return rootDir;
}

export function encodeProjectDirName(dir: string): string {
  return dir
    .replace(/\\/g, '-')
    .replace(/\//g, '-')
    .replace(/:/g, '-')
    .replace(/\./g, '-')
    .replace(/_/g, '-');
}

export function decodeProjectDirName(name: string): string {
  // Windows drive letter: "C--xxx" -> "C:\xxx"
  if (
    name.length >= 3 &&
    name[1] === '-' &&
    name[2] === '-' &&
    name[0] >= 'A' &&
    name[0] <= 'Z'
  ) {
    const rest = name.slice(3).replace(/-/g, '\\');
    return `${name[0]}:\\${rest}`;
  }

  const parts = name.split('-').filter((p) => p !== '');
  return `/${parts.join('/')}`;
}

export function getSessionJsonlPath(sessionId: string, workDir: string): string {
  return path.join(rootDir, encodeProjectDirName(workDir), `${sessionId}.jsonl`);
}

export async function scanAll(): Promise<SessionMeta[]> {
  const results: SessionMeta[] = [];
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(rootDir, entry.name);
      const files = await fs.readdir(dirPath);
      let workDir = decodeProjectDirName(entry.name);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(dirPath, file);
        const stat = await fs.stat(filePath);
        const id = file.replace('.jsonl', '');
        const cwd = await scanCwd(filePath);
        if (cwd) workDir = cwd;
        results.push({
          id,
          workDir,
          path: filePath,
          updatedAt: stat.mtimeMs,
        });
      }
    }
  } catch {
    // root may not exist yet
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function scanCwd(filePath: string): Promise<string> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    for (const line of data.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.cwd) return parsed.cwd;
      } catch {
        // ignore invalid json
      }
    }
  } catch {
    // ignore read errors
  }
  return '';
}

export function watchProjects(onChange: () => void): () => void {
  const watcher = chokidar.watch(rootDir, {
    ignored: (p) => {
      const base = path.basename(p);
      const stat = (() => {
        try {
          return fsSync.statSync(p);
        } catch {
          return null;
        }
      })();
      if (stat?.isFile() && !p.endsWith('.jsonl')) return true;
      return false;
    },
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100 },
  });

  let timeout: NodeJS.Timeout | null = null;
  const emit = (p: string) => {
    if (!p.endsWith('.jsonl')) return;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(onChange, 500);
  };

  watcher.on('add', emit).on('change', emit).on('unlink', emit);
  return () => {
    if (timeout) clearTimeout(timeout);
    return watcher.close();
  };
}
