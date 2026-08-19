import { describe, it, expect } from 'vitest';
import { isAgentEnabledBySettings, agentSpec } from '../../../src/main/agents/registry.js';
import type { AgentKind } from '../../../src/main/agents/types.js';

function fakeSettings(overrides: Record<string, unknown> = {}) {
  return { get: (key: string, d?: unknown) => (key in overrides ? overrides[key] : d) };
}

describe('isAgentEnabledBySettings', () => {
  it('claude 恒启用（不读开关）', () => {
    expect(isAgentEnabledBySettings(fakeSettings(), 'claude')).toBe(true);
  });
  it('缺省开关默认关闭', () => {
    for (const k of ['codex', 'opencode', 'omp'] as AgentKind[]) {
      expect(isAgentEnabledBySettings(fakeSettings(), k)).toBe(false);
    }
  });
  it('显式开启后启用', () => {
    expect(isAgentEnabledBySettings(fakeSettings({ codex_enabled: true }), 'codex')).toBe(true);
    expect(isAgentEnabledBySettings(fakeSettings({ codex_enabled: false }), 'codex')).toBe(false);
  });
  it('agentSpec 未知回退 claude', () => {
    expect(agentSpec('unknown' as AgentKind).kind).toBe('claude');
  });
});
