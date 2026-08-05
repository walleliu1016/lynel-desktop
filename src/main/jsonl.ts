import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import chokidar from 'chokidar';

export interface SessionMeta {
  id: string;
  workdir: string;
  project: string;
  mtime: number;
  msg_count: number;
  first_prompt: string;
  ai_title: string;
  size: number;
  user_title?: string;
  title_source?: 'user' | 'ai' | 'first_prompt';
}

export type TitleSource = 'user' | 'ai' | 'first_prompt';

export interface JsonlMessage {
  role: string;
  content: unknown;
  timestamp: number;
}

let rootDir = path.join(os.homedir(), '.claude', 'projects');

export function setRoot(dir: string): void {
  rootDir = dir;
  // root 变了缓存的路径空间整体失效
  fileMetaCache.clear();
}

export function getRoot(): string {
  return rootDir;
}

// 与 Claude Code 的项目目录编码完全一致：非 [A-Za-z0-9-] 字符一律替换为 '-'。
// 例：'G:\美团技术书籍' → 'G--------'；'G:\work\lynel-desktop' → 'G--work-lynel-desktop'。
// 之前只替换 :/\\._ 会保留中文（'G--美团技术书籍'），导致 listSessionIds / getSessionJsonlPath
// 读错目录，/clear 后的新 jsonl 找不到，rebind 超时。
export function encodeProjectDirName(dir: string): string {
  return dir.replace(/[^A-Za-z0-9-]/g, '-');
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

/** 某 workdir 对应的项目 jsonl 目录路径。 */
export function getProjectDirPath(workDir: string): string {
  return path.join(rootDir, encodeProjectDirName(workDir));
}

/** 列出某 workdir 下已有的 session id（jsonl 文件名去掉后缀）。用于 /clear 后识别新会话。 */
export function listSessionIds(workDir: string): string[] {
  try {
    return fsSync
      .readdirSync(getProjectDirPath(workDir))
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => f.slice(0, -'.jsonl'.length));
  } catch {
    return [];
  }
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
        const meta = await scanFileMeta(filePath, stat);
        if (meta.cwd) workDir = meta.cwd;
        results.push({
          id,
          workdir: workDir,
          project: projectName(workDir),
          mtime: Math.floor(stat.mtimeMs / 1000),
          msg_count: meta.msgCount,
          first_prompt: meta.firstPrompt,
          ai_title: meta.aiTitle,
          size: stat.size,
        });
      }
    }
  } catch {
    // root may not exist yet
  }
  return results.sort((a, b) => {
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.id.localeCompare(b.id);
  });
}

function projectName(workDir: string): string {
  if (!workDir || workDir === '/') return workDir;
  const clean = workDir.replace(/\\/g, '/');
  const base = path.posix.basename(clean);
  if (!base || base === '.' || base === '/') return workDir;
  return base;
}

interface FileMeta {
  firstPrompt: string;
  aiTitle: string;
  cwd: string;
  msgCount: number;
}

// scanFileMeta 结果缓存：key=文件路径，(mtimeMs, size) 未变则直接命中，
// 把 sessions 列表的全量重扫变成 stat-only。文件截断/重写（size 或 mtime 变化）自然失效。
// 简单 LRU：超过上限逐出最久未用的条目。
const FILE_META_CACHE_MAX = 1024;
const fileMetaCache = new Map<string, { mtimeMs: number; size: number; meta: FileMeta }>();

// 测试/外部清理用：清空 scanFileMeta 缓存
export function clearFileMetaCache(): void {
  fileMetaCache.clear();
}

// 测试也需要直接调用（构造固定 stat 验证缓存命中/失效）
export async function scanFileMeta(filePath: string, stat?: fsSync.Stats): Promise<FileMeta> {
  if (stat) {
    const hit = fileMetaCache.get(filePath);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      // LRU：命中后移到末尾
      fileMetaCache.delete(filePath);
      fileMetaCache.set(filePath, hit);
      return hit.meta;
    }
  }
  const result: FileMeta = { firstPrompt: '', aiTitle: '', cwd: '', msgCount: 0 };
  try {
    const stream = fsSync.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      result.msgCount++;
      if (result.firstPrompt && result.aiTitle && result.cwd) continue;
      const parsed = safeParseLine(line);
      if (!parsed) continue;
      if (!result.cwd && parsed.cwd) result.cwd = parsed.cwd;
      if (!result.aiTitle && parsed.ai_title) result.aiTitle = parsed.ai_title;
      if (!result.firstPrompt && parsed.message && typeof parsed.message === 'object') {
        const msg = parsed.message as Record<string, unknown>;
        if (msg.role === 'user') {
          const text = contentText(msg.content);
          // 跳过系统注入的 XML 上下文（local-command-caveat / command-name / SessionStart 注入等），
          // 只把真正的用户输入当作 first_prompt。
          if (text && !isInjectedPrompt(text)) result.firstPrompt = text;
        }
      }
    }
  } catch {
    // ignore read errors
  }
  if (stat) {
    if (fileMetaCache.size >= FILE_META_CACHE_MAX) {
      const oldest = fileMetaCache.keys().next().value;
      if (oldest !== undefined) fileMetaCache.delete(oldest);
    }
    fileMetaCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, meta: result });
  }
  return result;
}

interface RawLine {
  type?: string;
  message?: unknown;
  ai_title?: string;
  aiTitle?: string;
  title?: string;
  cwd?: string;
  timestamp?: string;
  attachment?: RawAttachment;
}

interface RawAttachment {
  type?: string;
  hookName?: string;
  hookEvent?: string;
  toolUseID?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

function safeParseLine(line: string): RawLine | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as RawLine;
  } catch {
    return null;
  }
}

/** Claude Code 会把本地命令 / slash 命令 / hook 注入的上下文作为首条 user 消息写入 jsonl
 *  （如 <local-command-caveat>、<command-name>、<EXTREMELY_IMPORTANT> 等 XML 块）。
 *  这些不是用户真实输入，不应作为 first_prompt 展示。识别特征：trim 后首行为 XML 标签。 */
export function isInjectedPrompt(text: string): boolean {
  return /^<[a-zA-Z][^>\n]*>/.test(text.trim());
}

function contentText(content: unknown): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
      if (block.type === 'thinking' && typeof block.thinking === 'string') parts.push(block.thinking);
    }
    return parts.join('\n\n').trim();
  }
  return '';
}

export async function parseMessages(
  filePath: string,
  offset = 0,
  limit = 0,
): Promise<JsonlMessage[]> {
  const out: JsonlMessage[] = [];
  try {
    const stream = fsSync.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineNum = 0;
    for await (const line of rl) {
      lineNum++;
      if (offset > 0 && lineNum <= offset) continue;
      if (limit > 0 && out.length >= limit) break;
      const parsed = safeParseLine(line);
      if (!parsed || !parsed.message || typeof parsed.message !== 'object') continue;
      const msg = parsed.message as Record<string, unknown>;
      if (!msg.role) continue;
      out.push({
        role: String(msg.role),
        content: msg.content,
        timestamp: parseTimestamp(parsed.timestamp),
      });
    }
  } catch {
    // ignore read errors
  }
  return out;
}

function parseTimestamp(ts: string | undefined): number {
  if (!ts) return Date.now();
  const d = Date.parse(ts);
  return isNaN(d) ? Date.now() : d;
}

function toolInputSummary(name: string, input: unknown): string {
  if (input === null || input === undefined) return '';
  let args: Record<string, unknown>;
  if (typeof input === 'object') {
    args = input as Record<string, unknown>;
  } else {
    return truncate(String(input), 120);
  }
  switch (name) {
    case 'Bash':
      if (typeof args.command === 'string') return truncate(args.command, 120);
      break;
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      if (typeof args.file_path === 'string') return args.file_path;
      break;
    case 'Glob':
      if (typeof args.pattern === 'string') return truncate(args.pattern, 120);
      break;
    case 'Grep': {
      const pat = typeof args.pattern === 'string' ? args.pattern : '';
      const p = typeof args.path === 'string' ? args.path : '';
      if (pat) return p ? `${truncate(pat, 60)} in ${p}` : truncate(pat, 120);
      break;
    }
    case 'WebFetch':
      if (typeof args.url === 'string') return truncate(args.url, 120);
      break;
    case 'WebSearch':
      if (typeof args.query === 'string') return truncate(args.query, 120);
      break;
  }
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v) return truncate(v, 120);
  }
  return truncate(JSON.stringify(args), 120);
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max) + `…(+${s.length - max})`;
}

export async function scanFileAiTitle(filePath: string): Promise<string> {
  try {
    const stream = fsSync.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const parsed = safeParseLine(line);
      if (!parsed) continue;
      // LovStudio-style ai-title event
      if (parsed.type === 'ai-title' && typeof parsed.aiTitle === 'string' && parsed.aiTitle) {
        return parsed.aiTitle;
      }
      // legacy ai_title field
      if (typeof parsed.ai_title === 'string' && parsed.ai_title) {
        return parsed.ai_title;
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

  watcher.on('add', emit).on('change', emit).on('unlink', (p) => {
    // 文件删除时清掉对应 meta 缓存，避免同路径重建后命中旧缓存
    fileMetaCache.delete(p);
    emit(p);
  });
  return () => {
    if (timeout) clearTimeout(timeout);
    return watcher.close();
  };
}
