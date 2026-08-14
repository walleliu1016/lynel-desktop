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
  it('已存在的同段保留用户自定义键', () => {
    const existing = '[model_providers.lynel]\nname = "lynel"\nbase_url = "https://old.com"\nmax_tokens = 1000\n';
    const out = mergeCodexConfigToml(existing, { ...base, base_url: 'https://new.com' });
    expect(out).toContain('max_tokens = 1000');
    expect(out).toContain('base_url = "https://new.com"');
    expect(out).not.toContain('https://old.com');
  });
  it('codex_provider 自定义段名', () => {
    const out = mergeCodexConfigToml(null, { ...base, codex_provider: 'deepseek' });
    expect(out).toContain('[model_providers.deepseek]');
  });
  it('既有顶层 model/model_provider 不产生重复键', () => {
    const existing = 'model = "gpt-5"\nmodel_provider = "openai"\n\n[model_providers.lynel]\nname = "lynel"\nbase_url = "https://old.com"\n\n[model_providers.other]\nbase_url = "https://o.com"\n';
    const out = mergeCodexConfigToml(existing, { ...base, default_model: 'gpt-new', base_url: 'https://new.com' });
    const head = out.split('\n');
    const root = head.slice(0, head.findIndex((l) => /^\s*\[/.test(l)));
    expect(root.filter((l) => l.trim().startsWith('model ='))).toHaveLength(1);
    expect(root.filter((l) => l.trim().startsWith('model_provider ='))).toHaveLength(1);
    expect(root.some((l) => l.trim() === 'model = "gpt-new"')).toBe(true);
    expect(root.some((l) => l.trim() === 'model_provider = "lynel"')).toBe(true);
    expect(root.some((l) => l.trim() === 'model = "gpt-5"')).toBe(false);
    expect(out).toContain('[model_providers.other]');
    expect(out).toContain('base_url = "https://o.com"');
  });
  it('替换路径前面已有其他表时，顶层 model/model_provider 仍落在根级区', () => {
    const existing = 'model = "gpt-5"\nmodel_provider = "openai"\n[model_providers.openai]\nname = "OpenAI"\nbase_url = "https://api.openai.com"\n[model_providers.lynel]\nname = "lynel"\nbase_url = "https://old.com"\n';
    const out = mergeCodexConfigToml(existing, { ...base, default_model: 'm', base_url: 'https://new.com' });
    const head = out.split('\n');
    const root = head.slice(0, head.findIndex((l) => /^\s*\[/.test(l)));
    expect(root.filter((l) => l.trim().startsWith('model ='))).toHaveLength(1);
    expect(root.filter((l) => l.trim().startsWith('model_provider ='))).toHaveLength(1);
    expect(root.some((l) => l.trim() === 'model = "m"')).toBe(true);
    expect(root.some((l) => l.trim() === 'model_provider = "lynel"')).toBe(true);
    expect(root.some((l) => l.trim() === 'model = "gpt-5"')).toBe(false);
    // 前面已存在的 [model_providers.openai] 块内容完整保留，且未被新增顶层键污染
    const openaiIdx = out.indexOf('[model_providers.openai]');
    const lynelIdx = out.indexOf('[model_providers.lynel]');
    expect(openaiIdx).toBeGreaterThan(-1);
    expect(lynelIdx).toBeGreaterThan(openaiIdx);
    expect(out).toContain('name = "OpenAI"');
    expect(out).toContain('base_url = "https://api.openai.com"');
    expect(out).toContain('base_url = "https://new.com"');
  });
  it('无既有同段时同样避免重复顶层 model/model_provider', () => {
    const existing = 'model = "gpt-5"\nmodel_provider = "openai"\n\n[model_providers.other]\nbase_url = "https://o.com"\n';
    const out = mergeCodexConfigToml(existing, { ...base, default_model: 'gpt-new', base_url: 'https://new.com' });
    const head = out.split('\n');
    const root = head.slice(0, head.findIndex((l) => /^\s*\[/.test(l)));
    expect(root.filter((l) => l.trim().startsWith('model ='))).toHaveLength(1);
    expect(root.filter((l) => l.trim().startsWith('model_provider ='))).toHaveLength(1);
    expect(root.some((l) => l.trim() === 'model = "gpt-new"')).toBe(true);
    expect(root.some((l) => l.trim() === 'model_provider = "lynel"')).toBe(true);
    expect(root.some((l) => l.trim() === 'model = "gpt-5"')).toBe(false);
    expect(out).toContain('[model_providers.other]');
    expect(out).toContain('[model_providers.lynel]');
    expect(out).toContain('base_url = "https://o.com"');
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
  it('已存在 models 时新的 default_model 仍覆盖生效', () => {
    const existing = JSON.stringify({ provider: { 'opencode-go': { options: { baseURL: 'https://old.com', models: { 'old-model': { name: 'old-model' } } } } } });
    const out = JSON.parse(mergeOpencodeConfig(existing, { ...base, default_model: 'new-model' }));
    expect(out.provider['opencode-go'].options.models).toEqual({ 'new-model': { name: 'new-model' } });
  });
  it('无法解析的 JSON（注释/尾逗号）原样返回不覆盖', () => {
    const existing = '{ "provider": { /* c */ } }';
    expect(mergeOpencodeConfig(existing, { ...base, base_url: 'https://new.com' })).toBe(existing);
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
  it('deepseek 块保留 apiKey 与 models，仅更新 baseUrl', () => {
    const existing = 'providers:\n  deepseek:\n    baseUrl: "https://old.com"\n    apiKey: "old"\n    models:\n      - name: deepseek-chat\n';
    const out = mergeOmpModelsYml(existing, 'https://new.com');
    expect(out).toContain('baseUrl: "https://new.com"');
    expect(out).toContain('apiKey: "old"');
    expect(out).toContain('models:');
    expect(out).toContain('- name: deepseek-chat');
    expect(out).not.toContain('https://old.com');
  });
  it('4 空格缩进的 providers 块保留同级 provider', () => {
    const existing = 'providers:\n    deepseek:\n        baseUrl: "https://old.com"\n        models:\n            - name: x\n    other:\n        baseUrl: "https://o.com"\n';
    const out = mergeOmpModelsYml(existing, 'https://new.com');
    expect(out).toContain('baseUrl: "https://new.com"');
    expect(out).toContain('    other:');
    expect(out).toContain('        baseUrl: "https://o.com"');
    expect(out).toContain('- name: x');
    expect(out).not.toContain('https://old.com');
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
