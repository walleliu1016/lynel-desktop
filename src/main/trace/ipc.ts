// trace IPC handlers: 完整 ccglass 式 trace 面板所需的主进程 API
import { ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HappyJsonlWriter } from '../archive/happyJsonl.js';
import { listRawExchanges, readRawExchange } from '../archive/rawArchive.js';
import { requestTiming, recordModel } from '../trace/timing.js';
import { anthropicAdapter } from '../formats/anthropic.js';
import { summarizeUsage, type RawExchange } from '../cost/usage.js';
import { costFromUsage } from '../cost/priceTable.js';
import type { UsageSummary } from '../cost/usage.js';

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

export interface TraceSummary {
  id: string;
  seq: number;
  ts: number;
  startedAt: number;
  firstByteAt: number | null;
  finishedAt: number;
  model: string | null;
  status: number;
  latencyMs: number | null;
  format: string;
  error: boolean;
  cost: { usd: number; input: number; output: number };
  trace: { totalMs: number; ttftMs: number; genMs: number; inTps: number | null; outTps: number | null };
}

function summarize(exchange: any): TraceSummary {
  const body = exchange?.request?.body || {};
  const usage = exchange?.reassembled?.usage || {};
  const timing = exchange?.trace || { totalMs: 0, ttftMs: 0, genMs: 0, inTps: null, outTps: null };
  return {
    id: exchange.id,
    seq: exchange.seq,
    ts: exchange.ts,
    startedAt: exchange.startedAt,
    firstByteAt: exchange.firstByteAt,
    finishedAt: exchange.finishedAt,
    model: exchange.model || recordModel(body, null),
    status: exchange.response?.status ?? 0,
    latencyMs: timing.totalMs ?? null,
    format: exchange.format,
    error: exchange.error === true,
    cost: {
      usd: exchange.cost?.usd ?? 0,
      input: exchange.cost?.input ?? 0,
      output: exchange.cost?.output ?? 0,
    },
    trace: timing,
  };
}

export function registerTraceIpc(): void {
  ipcMain.handle('trace:listSessions', async (_event, workDir: string) => {
    const projectDir = path.join(os.homedir(), '.lynel-desktop', 'projects', projectKeyFor(workDir));
    if (!fs.existsSync(projectDir)) return [];
    return fs.readdirSync(projectDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  });

  ipcMain.handle('trace:listRequests', async (_event, workDir: string, sessionId: string, _modelFilter?: string) => {
    const dir = sessionDirFor(workDir, sessionId);
    const seqs = listRawExchanges(dir);
    const out: TraceSummary[] = [];
    for (const seq of seqs) {
      const ex = readRawExchange(dir, seq);
      if (ex) out.push(summarize(ex));
    }
    return out;
  });

  ipcMain.handle('trace:sessionStats', async (_event, workDir: string, sessionId: string, _modelFilter?: string) => {
    const dir = sessionDirFor(workDir, sessionId);
    const seqs = listRawExchanges(dir);
    const records: RawExchange[] = [];
    for (const seq of seqs) {
      const ex = readRawExchange(dir, seq);
      if (ex) {
        records.push({
          session: sessionId,
          seq: ex.seq,
          ts: ex.ts,
          model: ex.model,
          usage: ex.reassembled?.usage,
          cost: ex.cost,
        });
      }
    }
    return summarizeUsage(records);
  });

  ipcMain.handle('trace:request', async (_event, workDir: string, sessionId: string, seq: number) => {
    const dir = sessionDirFor(workDir, sessionId);
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
    const dir = sessionDirFor(workDir, sessionId);
    const a = readRawExchange(dir, seqA);
    const b = readRawExchange(dir, seqB);
    if (!a || !b) return null;
    const blocksA = anthropicAdapter.blocks(a.request?.body || {});
    const blocksB = anthropicAdapter.blocks(b.request?.body || {});
    return { a: { seq: seqA, blocks: blocksA }, b: { seq: seqB, blocks: blocksB } };
  });

  ipcMain.handle('trace:usage', async () => {
    const usageFile = path.join(os.homedir(), '.lynel-desktop', 'usage.json');
    if (!fs.existsSync(usageFile)) {
      const empty: UsageSummary = {
        sessionCount: 0, requestCount: 0, unmeasured: 0,
        range: { from: null, to: null },
        totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalInput: 0, cacheHitRate: 0, usd: 0 },
        byModel: [],
        bySession: [],
      };
      return empty;
    }
    const data = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
    // 剔除内部 __records 字段
    const { __records, ...summary } = data;
    return summary as UsageSummary;
  });

  ipcMain.handle('trace:export', async (_event, workDir: string, sessionId: string, seq: number, format: string) => {
    const dir = sessionDirFor(workDir, sessionId);
    const ex = readRawExchange(dir, seq);
    if (!ex) return null;
    if (format === 'raw') {
      return JSON.stringify(ex, null, 2);
    }
    if (format === 'json') {
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

  ipcMain.handle('trace:envelopes', async (_event, workDir: string, sessionId: string) => {
    const dir = sessionDirFor(workDir, sessionId);
    return HappyJsonlWriter.readAll(dir);
  });
}

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
  // 简化版 HAR
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
