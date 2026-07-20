// 模型定价表 + token 估算 + USD 计算
// 移植自 ccglass src/tokens.js

export interface Price {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// USD per 1M tokens
export const PRICES: Record<string, Price> = {
  opus:        { input: 5,   output: 25,  cacheWrite: 6.25,   cacheRead: 0.5 },
  opusLegacy:  { input: 15,  output: 75,  cacheWrite: 18.75,  cacheRead: 1.5 },
  sonnet:      { input: 3,   output: 15,  cacheWrite: 3.75,   cacheRead: 0.3 },
  haiku45:     { input: 1,   output: 5,   cacheWrite: 1.25,   cacheRead: 0.1 },
  haiku35:     { input: 0.8, output: 4,   cacheWrite: 1.0,    cacheRead: 0.08 },
  haiku3:      { input: 0.25, output: 1.25, cacheWrite: 0.3125, cacheRead: 0.025 },
};

export function priceFor(model: string): Price {
  const m = model.toLowerCase();
  if (m.includes('opus')) {
    // Opus 3/4/4.1 旧价，4.5+/4.6+ 新价
    if (m.includes('3-opus') || m.includes('opus-4-1') || /opus-4-20\d\d/.test(m)) {
      return PRICES.opusLegacy;
    }
    return PRICES.opus;
  }
  if (m.includes('haiku')) {
    if (m.includes('3-5-haiku')) return PRICES.haiku35;
    if (m.includes('3-haiku')) return PRICES.haiku3;
    return PRICES.haiku45;
  }
  return PRICES.sonnet;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  totalInput: number;
  cacheHitRate: number;
  usd: number;
}

export interface UsageLike {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

export function costFromUsage(model: string, usage: UsageLike): CostBreakdown {
  const p = priceFor(model);
  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const usd = (input * p.input + output * p.output + cacheWrite * p.cacheWrite + cacheRead * p.cacheRead) / 1e6;
  const totalInput = input + cacheWrite + cacheRead;
  return {
    input,
    output,
    cacheWrite,
    cacheRead,
    totalInput,
    cacheHitRate: totalInput ? cacheRead / totalInput : 0,
    usd,
  };
}

// CJK 字符按 1.5 计，其余按 1/4，rough preview
const CJK_RE = /[㐀-鿿豈-﫿぀-ヿ]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) || []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 1.5 + rest / 4);
}
