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
}

export interface JsonlMessage {
  role: string;
  content: unknown;
  timestamp: number;
}

export interface ToolExecution {
  id: string;
  kind: 'tool' | 'llm';
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  status: 'running' | 'success' | 'error';
  input: string;
  output: string;
  exitCode: number;
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
        const meta = await scanFileMeta(filePath);
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

async function scanFileMeta(filePath: string): Promise<FileMeta> {
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
          if (text) result.firstPrompt = text;
        }
      }
    }
  } catch {
    // ignore read errors
  }
  return result;
}

interface RawLine {
  type?: string;
  message?: unknown;
  ai_title?: string;
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

export async function parseToolExecutions(filePath: string): Promise<ToolExecution[]> {
  const execs = new Map<string, ToolExecution>();
  const msgs: JsonlMessage[] = [];
  try {
    const stream = fsSync.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const parsed = safeParseLine(line);
      if (!parsed) continue;
      const ts = parseTimestamp(parsed.timestamp);

      if (parsed.type === 'user' || parsed.type === 'assistant') {
        if (!parsed.message || typeof parsed.message !== 'object') continue;
        const msg = parsed.message as Record<string, unknown>;
        msgs.push({ role: String(msg.role), content: msg.content, timestamp: ts });

        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          for (const b of msg.content) {
            if (!b || typeof b !== 'object') continue;
            const block = b as Record<string, unknown>;
            if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;
            const id = typeof block.id === 'string' ? block.id : block.name;
            if (!execs.has(id)) {
              execs.set(id, {
                id,
                kind: 'tool',
                name: block.name,
                startedAt: 0,
                endedAt: 0,
                durationMs: 0,
                status: 'running',
                input: toolInputSummary(block.name, block.input),
                output: '',
                exitCode: 0,
              });
            }
          }
        }
        continue;
      }

      if (parsed.type === 'attachment' && parsed.attachment) {
        const att = parsed.attachment;
        if (
          att.hookEvent !== 'PreToolUse' &&
          att.hookEvent !== 'PostToolUse' &&
          att.hookEvent !== 'PostToolUseFailure'
        ) {
          continue;
        }
        const id = att.toolUseID;
        if (!id) continue;
        if (!execs.has(id)) {
          execs.set(id, { id, kind: 'tool', name: '', startedAt: 0, endedAt: 0, durationMs: 0, status: 'running', input: '', output: '', exitCode: 0 });
        }
        const e = execs.get(id)!;
        if (att.hookName) {
          const parts = att.hookName.split(':');
          e.name = parts.length === 2 ? parts[1] : att.hookName;
        }
        if (att.hookEvent === 'PreToolUse') {
          e.startedAt = ts;
          e.status = 'running';
        } else if (att.hookEvent === 'PostToolUse') {
          e.endedAt = ts;
          e.durationMs = e.endedAt - e.startedAt;
          e.status = 'success';
          e.output = att.stdout ?? '';
          e.exitCode = att.exitCode ?? 0;
        } else if (att.hookEvent === 'PostToolUseFailure') {
          e.endedAt = ts;
          e.durationMs = e.endedAt - e.startedAt;
          e.status = 'error';
          e.output = att.stderr ?? '';
          e.exitCode = att.exitCode ?? 0;
        }
      }
    }
  } catch {
    // ignore read errors
  }

  // 从 user 消息的 tool_result 补 output
  for (const m of msgs) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block.type !== 'tool_result') continue;
      const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
      const e = execs.get(toolUseId);
      if (!e || e.output) continue;
      e.output = toolResultSummary(block.content);
    }
  }

  const out: ToolExecution[] = [];
  for (const e of execs.values()) {
    if (e.startedAt === 0) e.startedAt = e.endedAt;
    if (e.endedAt === 0) e.status = 'running';
    if (e.durationMs === 0 && e.endedAt > e.startedAt) e.durationMs = e.endedAt - e.startedAt;
    out.push(e);
  }

  // LLM 调用：每条带 text/thinking 的 assistant 消息
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const hasText = m.content.some(
      (b: unknown) =>
        b &&
        typeof b === 'object' &&
        ((b as Record<string, unknown>).type === 'text' || (b as Record<string, unknown>).type === 'thinking'),
    );
    if (!hasText) continue;
    const end = i + 1 < msgs.length ? msgs[i + 1].timestamp : m.timestamp;
    out.push({
      id: `llm-${i}`,
      kind: 'llm',
      name: 'LLM',
      startedAt: m.timestamp,
      endedAt: end,
      durationMs: end - m.timestamp,
      status: 'success',
      input: '',
      output: llmOutputSummary(m.content as unknown[]),
      exitCode: 0,
    });
  }

  out.sort((a, b) => {
    if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt;
    return a.id.localeCompare(b.id);
  });
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

function toolResultSummary(content: unknown): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content.replace(/\s+$/, '');
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text') {
        const text = (b as Record<string, unknown>).text;
        if (typeof text === 'string') parts.push(text);
      }
    }
    return parts.join('\n').replace(/\s+$/, '');
  }
  return truncate(JSON.stringify(content), 1500);
}

function llmOutputSummary(content: unknown[]): string {
  const parts: string[] = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    const block = b as Record<string, unknown>;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    if (block.type === 'thinking' && typeof block.thinking === 'string') parts.push(block.thinking);
  }
  return truncate(parts.join(' '), 200);
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max) + `…(+${s.length - max})`;
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
