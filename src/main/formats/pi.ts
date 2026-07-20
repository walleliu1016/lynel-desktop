// pi-agent FormatAdapter - 预留
import type { FormatAdapter } from './format.js';

export const piAdapter: FormatAdapter = {
  name: 'pi',
  parseRequest: () => ({}),
  parseHttpError: (status, raw) => `HTTP ${status}: ${raw.slice(0, 200)}`,
  reassembleResponse: () => null,
  view: () => ({ system: [], messages: [], tools: [] }),
  blocks: () => [],
  estimateTokens: () => 0,
  costFromUsage: () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, totalInput: 0, cacheHitRate: 0, usd: 0 }),
};
