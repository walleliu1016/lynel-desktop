import { describe, it, expect } from 'vitest';
import {
  agentOf,
  applyClaudeEnv,
  mergeCodexConfigToml,
  mergeOpencodeConfig,
  mergeOmpModelsYml,
  migrateActiveProviders,
} from '../../src/main/providers-apply.js';

const base = { id: 'p1', name: '供应商', base_url: '', auth_token: '', default_model: '' };

describe('agentOf', () => {
  it('缺省 claude', () => expect(agentOf({})).toBe('claude'));
  it('透传已知 agent', () => expect(agentOf({ agent: 'codex' })).toBe('codex'));
});

describe('applyClaudeEnv', () => {
  it('映射 claude env 字段', () => {
    const env = applyClaudeEnv({ ...base, base_url: 'https://a.com', auth_token: 'tk', default_model: 'm', default_haiku_model: 'h', default_sonnet_model: 's', default_opus_model: 'o', reasoning_model: 'r' });
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: 'https://a.com',
      ANTHROPIC_AUTH_TOKEN: 'tk',
      ANTHROPIC_MODEL: 'm',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'h',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 's',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'o',
      ANTHROPIC_REASONING_MODEL: 'r',
    });
  });
  it('空字段不输出', () => expect(applyClaudeEnv(base)).toEqual({}));
});

describe('mergeCodexConfigToml', () => {
  it('空文件生成完整段', () => {
    const out = mergeCodexConfigToml(null, { ...base, base_url: 'https://a.com', auth_token: 'tk', default_model: 'm' });
    expect(out).toContain('model_provider = "lynel"');
    expect(out).toContain('model = "m"');
    expect(out).toContain('[model_providers.lynel]');
    expect(out).toContain(`base_url = "https://a.com"`);
    expect(out).toContain(`api_key = "${Buffer.from('tk').toString('base64')}"`);
  });
  it('替换已存在的同段不重复', () => {
    const existing = '[model_providers.lynel]\nname = "lynel"\nbase_url = "https://old.com"\n\n[model_providers.other]\nbase_url = "https://o.com"\n';
    const out = mergeCodexConfigToml(existing, { ...base, base_url: 'https://new.com' });
    expect(out.split('[model_providers.lynel]')).toHaveLength(2);
    expect(out).toContain('base_url = "https://new.com"');
    expect(out).toContain('[model_providers.other]');
  });
  it('codex_provider 自定义段名', () => {
    const out = mergeCodexConfigToml(null, { ...base, codex_provider: 'deepseek' });
    expect(out).toContain('[model_providers.deepseek]');
  });
});

describe('mergeOpencodeConfig', () => {
  it('空文件生成 provider 对象', () => {
    const out = JSON.parse(mergeOpencodeConfig(null, { ...base, base_url: 'https://a.com', auth_token: 'tk', default_model: 'm' }));
    expect(out.provider['opencode-go'].options.baseURL).toBe('https://a.com');
    expect(out.provider['opencode-go'].options.apiKey).toBe('tk');
  });
  it('保留已有 provider 段', () => {
    const existing = JSON.stringify({ provider: { other: { options: { baseURL: 'https://o.com' } } } });
    const out = JSON.parse(mergeOpencodeConfig(existing, { ...base, base_url: 'https://new.com' }));
    expect(out.provider.other.options.baseURL).toBe('https://o.com');
    expect(out.provider['opencode-go'].options.baseURL).toBe('https://new.com');
  });
});

describe('mergeOmpModelsYml', () => {
  it('空文件生成 deepseek 段', () => {
    const out = mergeOmpModelsYml(null, 'https://a.com', 'tk');
    expect(out).toBe('providers:\n  deepseek:\n    baseUrl: "https://a.com"\n    apiKey: "tk"\n');
  });
  it('替换已有 deepseek baseUrl 且保留其他键', () => {
    const existing = 'providers:\n  deepseek:\n    baseUrl: "https://old.com"\n    apiKey: "old"\n  other:\n    baseUrl: "https://o.com"\n';
    const out = mergeOmpModelsYml(existing, 'https://new.com');
    expect(out).toContain('baseUrl: "https://new.com"');
    expect(out).toContain('other:');
    expect(out).not.toContain('https://old.com');
  });
  it('无 apiKey 时不输出 apiKey 行', () => {
    const out = mergeOmpModelsYml(null, 'https://a.com');
    expect(out).not.toContain('apiKey');
  });
});

describe('migrateActiveProviders', () => {
  it('从旧 active_provider_id 迁移到 claude', () => {
    const cfg = migrateActiveProviders({ active_provider_id: 'x', providers: [] });
    expect(cfg.active_providers.claude).toBe('x');
  });
  it('已有 active_providers 不覆盖', () => {
    const cfg = migrateActiveProviders({ active_provider_id: 'old', active_providers: { claude: 'new' }, providers: [] });
    expect(cfg.active_providers.claude).toBe('new');
  });
  it('无 active 时用第一个 provider id', () => {
    const cfg = migrateActiveProviders({ providers: [{ id: 'first' }] });
    expect(cfg.active_providers.claude).toBe('first');
  });
});
