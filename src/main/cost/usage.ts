// Usage 汇总：跨 session 汇总 token / cost
// 移植自 ccglass src/usage.js

import { costFromUsage, type CostBreakdown, type UsageLike } from './priceTable.js';
import { recordModel } from '../trace/timing.js';

export interface RawExchange {
  session: string;
  seq: number;
  ts: number;
  request?: { body?: any } | null;
  response?: {
    status?: number;
    raw?: string;
  } | null;
  // 重组后已保存时使用
  model?: string;
  usage?: UsageLike;
  cost?: CostBreakdown;
}

export interface SessionBucket extends CostBreakdown {
  session: string;
  entries: number;
  from: string | null;
  to: string | null;
}

export interface UsageSummary {
  sessionCount: number;
  requestCount: number;
  unmeasured: number;
  range: { from: string | null; to: string | null };
  totals: CostBreakdown;
  byModel: Array<{ model: string } & CostBreakdown>;
  bySession: SessionBucket[];
}

function blankBucket(): CostBreakdown & { requests: number } {
  return {
    requests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalInput: 0,
    cacheHitRate: 0,
    usd: 0,
  };
}

function addInto(b: ReturnType<typeof blankBucket>, cost: CostBreakdown): void {
  b.requests += 1;
  b.input += cost.input || 0;
  b.output += cost.output || 0;
  b.cacheRead += cost.cacheRead || 0;
  b.cacheWrite += cost.cacheWrite || 0;
  b.totalInput += cost.totalInput || 0;
  b.usd += cost.usd || 0;
}

function deriveTotals(b: ReturnType<typeof blankBucket>): CostBreakdown {
  return { ...b, cacheHitRate: b.totalInput ? b.cacheRead / b.totalInput : 0 };
}

function costFor(rec: RawExchange): { cost: CostBreakdown; model: string } | null {
  if (rec.cost && rec.model) return { cost: rec.cost, model: rec.model };
  if (!rec.usage) return null;
  const u = rec.usage;
  if (!u.input_tokens && !u.output_tokens && !u.prompt_tokens && !u.completion_tokens) return null;
  const model = rec.model || recordModel(rec.request?.body, null) || 'unknown';
  return { cost: costFromUsage(model, u), model };
}

export function summarizeUsage(records: RawExchange[]): UsageSummary {
  const totals = blankBucket();
  const byModelMap = new Map<string, ReturnType<typeof blankBucket>>();
  const bySession = new Map<string, { bucket: ReturnType<typeof blankBucket>; entries: number; from: number | null; to: number | null }>();
  let unmeasured = 0;
  let from: number | null = null;
  let to: number | null = null;

  for (const rec of records) {
    if (rec.ts) {
      if (from == null || rec.ts < from) from = rec.ts;
      if (to == null || rec.ts > to) to = rec.ts;
    }

    const res = costFor(rec);
    if (!res) {
      unmeasured += 1;
      continue;
    }

    addInto(totals, res.cost);
    if (!byModelMap.has(res.model)) byModelMap.set(res.model, blankBucket());
    addInto(byModelMap.get(res.model)!, res.cost);

    let entry = bySession.get(rec.session);
    if (!entry) {
      entry = { bucket: blankBucket(), entries: 0, from: null, to: null };
      bySession.set(rec.session, entry);
    }
    entry.entries += 1;
    addInto(entry.bucket, res.cost);
    if (rec.ts) {
      if (entry.from == null || rec.ts < entry.from) entry.from = rec.ts;
      if (entry.to == null || rec.ts > entry.to) entry.to = rec.ts;
    }
  }

  const byModel: Array<{ model: string } & CostBreakdown> = [...byModelMap.entries()]
    .map(([model, b]) => ({ model, ...deriveTotals(b) }))
    .sort((a, b) => b.usd - a.usd);

  const bySessionList: SessionBucket[] = [...bySession.entries()].map(([session, e]) => ({
    session,
    entries: e.entries,
    from: e.from ? new Date(e.from).toISOString() : null,
    to: e.to ? new Date(e.to).toISOString() : null,
    ...deriveTotals(e.bucket),
  }));

  return {
    sessionCount: bySessionList.length,
    requestCount: totals.requests,
    unmeasured,
    range: {
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to).toISOString() : null,
    },
    totals: deriveTotals(totals),
    byModel,
    bySession: bySessionList,
  };
}
