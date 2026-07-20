// Trace 字段计算：latency / TTFT / gen / token throughput
// 移植自 ccglass src/session-stats.js

export interface TraceInput {
  startedAt: number;
  firstByteAt: number | null;
  finishedAt: number;
}

export interface UsageLike {
  input_tokens?: number;
  output_tokens?: number;
}

export interface TraceTiming {
  totalMs: number;
  ttftMs: number;
  genMs: number;
  inTps: number | null;
  outTps: number | null;
}

export function latencyMs(rec: { startedAt?: number; ts?: number; finishedAt?: number | null }): number | null {
  const end = rec.finishedAt;
  if (end == null) return null;
  const start = rec.startedAt ?? rec.ts;
  if (start == null) return null;
  return Math.max(0, end - start);
}

export function requestTiming(rec: TraceInput & UsageLike): TraceTiming | null {
  const started = rec.startedAt;
  const end = rec.finishedAt;
  if (started == null || end == null) return null;

  const first = rec.firstByteAt ?? end;
  const totalMs = Math.max(0, end - started);
  const ttftMs = Math.max(0, first - started);
  const genMs = Math.max(0, end - first);

  const inTok = rec.input_tokens ?? 0;
  const outTok = rec.output_tokens ?? 0;
  const ttftSec = ttftMs / 1000;
  const genSec = genMs / 1000;

  return {
    totalMs,
    ttftMs,
    genMs,
    inTps: inTok > 0 && ttftSec > 0 ? inTok / ttftSec : null,
    outTps: outTok > 0 && genSec > 0 ? outTok / genSec : null,
  };
}

// 从请求 body / 响应重组结果中提取 model 名
export function recordModel(body: any, reassembled: { model?: string | null } | null): string | null {
  const bodyModel = body?.model;
  if (typeof bodyModel === 'string' && bodyModel) return bodyModel;
  if (reassembled?.model) return reassembled.model;
  return null;
}
