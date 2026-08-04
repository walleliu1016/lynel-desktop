// trace IPC handlers: 完整 ccglass 式 trace 面板所需的主进程 API
// v2: 基于 _summaries.jsonl 摘要索引，分页加载，不再扫描 raw 文件
import { ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { readRawExchange } from '../archive/rawArchive.js';
import { readSummaries, type SummaryRecord } from '../archive/rawArchive.js';
import { requestTiming, recordModel } from '../trace/timing.js';
import { anthropicAdapter } from '../formats/anthropic.js';
import { getBus } from '../events.js';

function projectKeyFor(workDir: string): string {
  const safe = workDir
    .replace(/^[A-Za-z]:/, (m) => m.replace(':', '-'))
    .replace(/[/\\]/g, '--')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/^--+/, '');
  return safe || 'root';
}

function sessionDirFor(workDir: string, sessionId: string): string {
  return path.join(os.homedir(), '.lynel-desktop', 'projects', projectKeyFor(workDir), sessionId);
}

// 兼容旧版本路径
function resolveDataDir(workDir: string, sessionId: string): string {
  const newPath = sessionDirFor(workDir, sessionId);
  if (fs.existsSync(newPath)) return newPath;
  const oldPath = path.join(os.homedir(), '.lynel-desktop', 'projects', projectKeyFor(workDir));
  if (fs.existsSync(oldPath)) return oldPath;
  return newPath;
}

// 前端 TraceSummary —— 基于 SummaryRecord，补少量展示用字段
export interface TraceSummary {
  seq: number;
  ts: number;
  model: string | null;
  status: number;
  latencyMs: number | null;
  error: boolean;
  cost: { usd: number; input: number; output: number };
  trace: { totalMs: number; ttftMs: number; genMs: number };
  toolCount: number;
}

function toTraceSummary(r: SummaryRecord): TraceSummary {
  return {
    seq: r.seq,
    ts: r.ts,
    model: r.model,
    status: r.status,
    latencyMs: r.latencyMs,
    error: r.error,
    cost: { usd: r.cost.usd, input: r.cost.input, output: r.cost.output },
    trace: { totalMs: r.trace.totalMs, ttftMs: r.trace.ttftMs, genMs: r.trace.genMs },
    toolCount: r.toolCount,
  };
}

export interface ListRequestsOpts {
  limit?: number;
  offset?: number;
  sinceSeq?: number;
  modelFilter?: string;
  errorsOnly?: boolean;
}

export interface ListRequestsResult {
  summaries: TraceSummary[];
  hasMore: boolean;
}

export function registerTraceIpc(): void {
  ipcMain.handle('trace:listSessions', async (_event, workDir: string) => {
    const projectDir = path.join(os.homedir(), '.lynel-desktop', 'projects', projectKeyFor(workDir));
    if (!fs.existsSync(projectDir)) return [];
    return fs.readdirSync(projectDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  });

  ipcMain.handle('trace:listRequests', async (_event, workDir: string, sessionId: string, opts?: ListRequestsOpts) => {
    const dir = resolveDataDir(workDir, sessionId);
    const all = readSummaries(dir);
    if (!all.length) return { summaries: [], hasMore: false };

    const { limit = 50, offset = 0, sinceSeq, modelFilter, errorsOnly } = opts ?? {};

    // sinceSeq 模式：只返回新条目，不分页
    if (sinceSeq != null) {
      const filtered = all
        .filter((r) => r.seq > sinceSeq)
        .map(toTraceSummary);
      return { summaries: filtered, hasMore: false };
    }

    // 过滤
    let filtered = all;
    if (modelFilter && modelFilter !== 'all') {
      filtered = filtered.filter((r) => r.model === modelFilter);
    }
    if (errorsOnly) {
      filtered = filtered.filter((r) => r.error || r.status >= 400);
    }

    // 分页：从尾部取（最新优先）
    const total = filtered.length;
    const start = Math.max(0, total - offset - limit);
    const end = total - offset;
    const page = filtered.slice(start, end);
    const hasMore = start > 0;

    return {
      summaries: page.map(toTraceSummary),
      hasMore,
    };
  });

  ipcMain.handle('trace:request', async (_event, workDir: string, sessionId: string, seq: number) => {
    const dir = resolveDataDir(workDir, sessionId);
    const ex = readRawExchange(dir, seq);
    if (!ex) return null;
    return {
      ...ex,
      timing: requestTiming({
        startedAt: ex.startedAt,
        firstByteAt: ex.firstByteAt,
        finishedAt: ex.finishedAt,
        input_tokens: ex.reassembled?.usage?.input_tokens,
        output_tokens: ex.reassembled?.usage?.output_tokens,
      }),
    };
  });

  ipcMain.handle('trace:diff', async (_event, workDir: string, sessionId: string, seqA: number, seqB: number) => {
    const dir = resolveDataDir(workDir, sessionId);
    const aEx = readRawExchange(dir, seqA);
    const bEx = readRawExchange(dir, seqB);
    if (!aEx || !bEx) return null;
    const blocksA = anthropicAdapter.blocks(aEx.request?.body || {});
    const blocksB = anthropicAdapter.blocks(bEx.request?.body || {});
    const labelKey = (b: any) => b.label;
    const setA = new Set(blocksA.map(labelKey));
    const setB = new Set(blocksB.map(labelKey));
    const added = blocksB.filter((b: any) => !setA.has(labelKey(b)));
    const removed = blocksA.filter((b: any) => !setB.has(labelKey(b)));
    const cachedInB = added.filter((b: any) => b.cache).length;
    const counts = { added: added.length, removed: removed.length, common: blocksA.length - removed.length, cachedInB };
    return { a: { seq: seqA }, b: { seq: seqB }, counts, added, removed };
  });

  ipcMain.handle('trace:export', async (_event, workDir: string, sessionId: string, seq: number, format: string) => {
    const dir = resolveDataDir(workDir, sessionId);
    const ex = readRawExchange(dir, seq);
    if (!ex) return null;
    if (format === 'raw' || format === 'json') {
      return JSON.stringify(ex, null, 2);
    }
    if (format === 'md') {
      return exportMarkdown(ex);
    }
    if (format === 'har') {
      return exportHar(ex);
    }
    return null;
  });

  // 文件变更通知：trace watcher（300ms debounce）
  const watcherTimers = new Map<string, NodeJS.Timeout>();
  ipcMain.handle('trace:watch', async (_event, workDir: string, sessionId: string) => {
    const dir = resolveDataDir(workDir, sessionId);
    const rawDir = path.join(dir, 'raw');
    if (watchers.has(rawDir)) return;
    try { await fs.promises.mkdir(rawDir, { recursive: true }); } catch { /* ignore */ }
    const watcher = chokidar.watch(rawDir, {
      ignoreInitial: true,
      depth: 0,
    });
    watcher.on('add', () => {
      const t = watcherTimers.get(rawDir);
      if (t) clearTimeout(t);
      watcherTimers.set(rawDir, setTimeout(() => {
        getBus().emit('trace:updated', workDir, sessionId);
      }, 300));
    });
    watchers.set(rawDir, watcher);
  });

  ipcMain.handle('trace:unwatch', async (_event, workDir: string, sessionId: string) => {
    const dir = resolveDataDir(workDir, sessionId);
    const rawDir = path.join(dir, 'raw');
    const watcher = watchers.get(rawDir);
    if (watcher) {
      const t = watcherTimers.get(rawDir);
      if (t) { clearTimeout(t); watcherTimers.delete(rawDir); }
      await watcher.close();
      watchers.delete(rawDir);
    }
  });
}

// session 维度 watcher 缓存
const watchers = new Map<string, FSWatcher>();

function exportMarkdown(ex: any): string {
  const body = ex.request?.body || {};
  const resp = ex.reassembled || {};
  const lines: string[] = [];
  lines.push(`# Roundtrip ${ex.seq}`);
  lines.push(`- Session: ${ex.session}`);
  lines.push(`- Model: ${ex.model || body.model || 'unknown'}`);
  lines.push(`- Status: ${ex.response?.status}`);
  lines.push(`- Latency: ${ex.trace?.totalMs}ms (TTFT: ${ex.trace?.ttftMs}ms)`);
  lines.push(`- Cost: $${(ex.cost?.usd ?? 0).toFixed(5)}`);
  if (body.messages) {
    lines.push(`\n## Messages (${body.messages.length})`);
    for (const m of body.messages) {
      const c = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
      for (const b of c) {
        lines.push(`- **${m.role}/${b.type}**: ${b.text || JSON.stringify(b).slice(0, 200)}`);
      }
    }
  }
  if (resp.content) {
    lines.push(`\n## Response (${resp.stop_reason})`);
    for (const b of resp.content) {
      lines.push(`- ${b.type}: ${b.text || JSON.stringify(b).slice(0, 200)}`);
    }
  }
  return lines.join('\n');
}

function exportHar(ex: any): string {
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'lynel-desktop', version: '0.0.8' },
      entries: [{
        startedDateTime: new Date(ex.ts).toISOString(),
        time: ex.trace?.totalMs ?? 0,
        request: {
          method: ex.request?.method || 'POST',
          url: ex.request?.url || '/v1/messages',
          httpVersion: 'HTTP/1.1',
          headers: Object.entries(ex.request?.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
          postData: { text: JSON.stringify(ex.request?.body || {}) },
        },
        response: {
          status: ex.response?.status || 0,
          statusText: '',
          httpVersion: 'HTTP/1.1',
          headers: Object.entries(ex.response?.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
          content: { text: ex.response?.raw || '', mimeType: 'text/event-stream' },
        },
        cache: {},
        timings: {
          send: 0,
          wait: ex.trace?.ttftMs ?? 0,
          receive: ex.trace?.genMs ?? 0,
        },
      }],
    },
  };
  return JSON.stringify(har, null, 2);
}
