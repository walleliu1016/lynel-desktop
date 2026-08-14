# 模型供应商页按 Agent 差异化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三个新 agent（codex/opencode/omp）拥有各自独立的供应商配置表单，支持 per-agent "设为当前"，UI 重构为 cc-switch 风格（顶部 agent 切换 + 卡片网格 + 编辑对话框）。

**Architecture:** 主进程把各 agent 激活写入提取为 `src/main/providers-apply.ts` 的纯函数（可单测），`app.ts` 只做按 agent 分派 + 文件读写；前端扩展 `types/providers.ts` 与 `stores/providers.ts` 支持 `active_providers` per-agent，重构 ProviderTab 为顶部工具条 + 卡片网格 + ProviderDialog 对话框。

**Tech Stack:** Electron 主进程（TypeScript）、Vue 3 `<script setup>` + Pinia setup store、vitest（主进程测试）、vue-tsc（前端类型检查）。

## Global Constraints

- 所有代码注释、commit message 用简体中文。
- commit 前必须 `npm run test:main` 和 `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 前端 vitest 是占位符（`echo "no tests yet"`），UI 任务验证用 `vue-tsc --noEmit` + 手动。
- 不引入 TOML / YAML 依赖，codex / omp 写入走文本级合并。
- 不修改 `~/.claude/settings.json` 的 hooks 与 permissions（仅 provider env 由激活写入管理）。
- 不动 `resolveUpstream` 对 opencode/omp 的固定 upstream 语义（spec 第 3 点已确认）。
- 数据模型向后兼容：旧 `active_provider_id` 读取时迁移到 `active_providers.claude`。

---

### Task 1: `providers-apply.ts` 纯函数 + 单测（TDD）

**Files:**
- Create: `src/main/providers-apply.ts`
- Test: `tests/main/providers-apply.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，无跨任务依赖）
- Produces:
  - `type AgentKind = 'claude' | 'codex' | 'opencode' | 'omp'`
  - `const AGENT_KINDS: AgentKind[]`
  - `interface ApplyProvider { id: string; agent?: string; name: string; base_url: string; auth_token: string; default_model: string; default_haiku_model?: string; default_sonnet_model?: string; default_opus_model?: string; reasoning_model?: string; codex_provider?: string }`
  - `agentOf(p: { agent?: string }): AgentKind`
  - `applyClaudeEnv(active: ApplyProvider): Record<string, string>`
  - `readCodexModelProvider(): { provider: string; baseUrl: string } | null`
  - `mergeCodexConfigToml(existing: string | null, p: ApplyProvider): string`
  - `mergeOpencodeConfig(existing: string | null, p: ApplyProvider): string`
  - `mergeOmpModelsYml(existing: string | null, baseUrl: string, apiKey?: string): string`
  - `migrateActiveProviders(cfg: any): any`

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/providers-apply.test.ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --dir tests/main providers-apply.test.ts`
Expected: FAIL（`Cannot find module .../providers-apply.js`）

- [ ] **Step 3: 实现 `src/main/providers-apply.ts`**

```ts
// Agent 供应商激活写入的纯函数集合。所有函数不依赖 App 实例，便于单测。
import fs from 'fs';
import os from 'os';
import path from 'path';

export const AGENT_KINDS = ['claude', 'codex', 'opencode', 'omp'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export interface ApplyProvider {
  id: string;
  agent?: string;
  name: string;
  base_url: string;
  auth_token: string;
  default_model: string;
  default_haiku_model?: string;
  default_sonnet_model?: string;
  default_opus_model?: string;
  reasoning_model?: string;
  codex_provider?: string;
}

export function agentOf(p: { agent?: string }): AgentKind {
  const a = p.agent as AgentKind;
  return (AGENT_KINDS as readonly string[]).includes(a) ? a : 'claude';
}

/** claude 激活：返回 settings.json 的 env 映射（空字段跳过） */
export function applyClaudeEnv(active: ApplyProvider): Record<string, string> {
  const env: Record<string, string> = {};
  if (active.base_url) env.ANTHROPIC_BASE_URL = active.base_url;
  if (active.auth_token) env.ANTHROPIC_AUTH_TOKEN = active.auth_token;
  if (active.default_model) env.ANTHROPIC_MODEL = active.default_model;
  if (active.default_haiku_model) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = active.default_haiku_model;
  if (active.default_sonnet_model) env.ANTHROPIC_DEFAULT_SONNET_MODEL = active.default_sonnet_model;
  if (active.default_opus_model) env.ANTHROPIC_DEFAULT_OPUS_MODEL = active.default_opus_model;
  if (active.reasoning_model) env.ANTHROPIC_REASONING_MODEL = active.reasoning_model;
  return env;
}

/** 读 ~/.codex/config.toml 的 model_providers.<name>.base_url（从 app.ts 迁移） */
export function readCodexModelProvider(): { provider: string; baseUrl: string } | null {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  try {
    if (!fs.existsSync(configPath)) return null;
    const toml = fs.readFileSync(configPath, 'utf8');
    const m = toml.match(/^\[model_providers\.(\S+)\][^\[]*?^base_url\s*=\s*"([^"]+)"/m);
    return m ? { provider: m[1], baseUrl: m[2] } : null;
  } catch {
    return null;
  }
}

/** codex 激活：文本级合并 config.toml，管理 model_providers.<name> 段与顶层 model/model_provider */
export function mergeCodexConfigToml(existing: string | null, p: ApplyProvider): string {
  const name = p.codex_provider || 'lynel';
  const text = (existing ?? '').trim();
  const lines = text ? text.split('\n') : [];
  const header = `[model_providers.${name}]`;
  const newSeg: string[] = [header, `name = "${name}"`];
  if (p.base_url) newSeg.push(`base_url = "${p.base_url}"`);
  if (p.auth_token) newSeg.push(`api_key = "${Buffer.from(p.auth_token).toString('base64')}"`);

  const out: string[] = [];
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === header) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    out.push(...lines.filter((l) => l.trim()));
    if (p.default_model) out.push(`model = "${p.default_model}"`);
    out.push(`model_provider = "${name}"`, '');
    out.push(...newSeg);
    return out.join('\n') + '\n';
  }
  let segEnd = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('[') && t.length > 1 && t.endsWith(']')) { segEnd = i; break; }
  }
  out.push(...lines.slice(0, headerIdx));
  if (p.default_model) out.push(`model = "${p.default_model}"`);
  out.push(`model_provider = "${name}"`, '');
  out.push(...newSeg);
  out.push(...lines.slice(segEnd));
  return out.join('\n') + '\n';
}

/** opencode 激活：JSON 合并 opencode.json 的 provider.opencode-go.options */
export function mergeOpencodeConfig(existing: string | null, p: ApplyProvider): string {
  let data: Record<string, any> = {};
  try {
    if (existing?.trim()) data = JSON.parse(existing);
  } catch {
    data = {};
  }
  if (!data.provider) data.provider = {};
  if (!data.provider['opencode-go']) data.provider['opencode-go'] = {};
  if (!data.provider['opencode-go'].options) data.provider['opencode-go'].options = {};
  const opts = data.provider['opencode-go'].options;
  if (p.base_url) opts.baseURL = p.base_url;
  if (p.auth_token) opts.apiKey = p.auth_token;
  if (p.default_model && !opts.models) opts.models = { [p.default_model]: { name: p.default_model } };
  return JSON.stringify(data, null, 2);
}

/** omp 激活：文本级合并 models.yml 的 providers.deepseek.baseUrl / apiKey，保留其他键 */
export function mergeOmpModelsYml(existing: string | null, baseUrl: string, apiKey?: string): string {
  const dsBody: string[] = [];
  if (baseUrl) dsBody.push(`    baseUrl: "${baseUrl}"`);
  if (apiKey) dsBody.push(`    apiKey: "${apiKey}"`);
  if (existing == null || !existing.trim()) {
    return `providers:\n  deepseek:\n${dsBody.join('\n')}\n`;
  }
  const lines = existing.split('\n');
  let providersIdx = -1;
  let blockEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('providers:')) { providersIdx = i; break; }
  }
  if (providersIdx === -1) {
    return existing.replace(/\s*$/, '') + `\nproviders:\n  deepseek:\n${dsBody.join('\n')}\n`;
  }
  for (let i = providersIdx + 1; i < lines.length; i++) {
    if (lines[i].length > 0 && !/^\s/.test(lines[i])) { blockEnd = i; break; }
  }
  const block = lines.slice(providersIdx, blockEnd);
  let dsIdx = -1;
  for (let i = 0; i < block.length; i++) {
    if (block[i].trimStart().startsWith('deepseek:')) { dsIdx = i; break; }
  }
  if (dsIdx === -1) {
    lines.splice(providersIdx + 1, 0, '  deepseek:', ...dsBody);
    return lines.join('\n');
  }
  const absDs = providersIdx + dsIdx;
  let dsEnd = blockEnd;
  for (let i = absDs + 1; i < blockEnd; i++) {
    if (/^ {2}\S/.test(lines[i])) { dsEnd = i; break; }
  }
  const keys: Record<string, string> = {};
  if (baseUrl) keys.baseUrl = baseUrl;
  if (apiKey) keys.apiKey = apiKey;
  const insert = Object.entries(keys).map(([k, v]) => `    ${k}: "${v}"`);
  lines.splice(absDs + 1, dsEnd - absDs - 1, ...insert);
  return lines.join('\n');
}

/** 迁移：active_provider_id → active_providers.claude（缺失时兜底第一个 provider） */
export function migrateActiveProviders(cfg: any): any {
  if (!cfg || typeof cfg !== 'object') return cfg;
  if (!cfg.active_providers || typeof cfg.active_providers !== 'object') {
    const claudeId =
      cfg.active_provider_id ||
      (Array.isArray(cfg.providers) && cfg.providers.length > 0 ? cfg.providers[0].id : '');
    cfg.active_providers = { claude: claudeId };
  }
  return cfg;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run --dir tests/main providers-apply.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add src/main/providers-apply.ts tests/main/providers-apply.test.ts
git commit -m "feat: 提取各 agent 供应商激活写入的纯函数（providers-apply）"
```

---

### Task 2: `app.ts` 接线——applyActiveProvider 分派 + 数据迁移

**Files:**
- Modify: `src/main/app.ts`（删除顶部旧 `readCodexModelProvider` / `mergeOmpDeepseekBaseUrl` 定义并 import 新函数；重构 `applyActiveProvider`；`GetProvidersConfig` 加迁移）
- Test: `tests/main/providers-apply.test.ts`（已覆盖纯函数，本任务验证编译 + 回归）

**Interfaces:**
- Consumes: `src/main/providers-apply.ts` 的 `agentOf / applyClaudeEnv / mergeCodexConfigToml / mergeOpencodeConfig / mergeOmpModelsYml / migrateActiveProviders / readCodexModelProvider / AGENT_KINDS`
- Produces: `app.ts` 的 `applyActiveProvider()`（IPC `app:applyActiveProvider`）按 agent 分派写入；`app:getProvidersConfig` 返回迁移后配置

- [ ] **Step 1: 移除 app.ts 顶部旧函数并 import 新函数**

删除 app.ts 第 62-75 行的 `readCodexModelProvider` 和 163 行起的 `mergeOmpDeepseekBaseUrl` 定义；在 import 区追加：

```ts
import { readCodexModelProvider, mergeOmpModelsYml, mergeCodexConfigToml, mergeOpencodeConfig, applyClaudeEnv, migrateActiveProviders, AGENT_KINDS } from './providers-apply.js';
```

将 `buildAgentInjection` 中 omp 分支的 `mergeOmpDeepseekBaseUrl(original, proxyUrl)` 调用改为 `mergeOmpModelsYml(original, proxyUrl)`（不传 apiKey，行为不变）。将 `resolveUpstream` 里对旧 `readCodexModelProvider` 的引用保持（现 import 同名函数）。

- [ ] **Step 2: 重构 `applyActiveProvider` 为按 agent 分派**

替换第 1086-1138 行的 `applyActiveProvider`，删除原方法体并新增：

```ts
private applyActiveProvider(): boolean {
  const cfg = (this.providersStore.get('config', {}) as Record<string, any>) || {};
  const providers = (cfg.providers as any[] | undefined) || [];
  const active = (cfg.active_providers as Record<string, string> | undefined) || {};
  let anyApplied = false;
  for (const kind of AGENT_KINDS) {
    const id = active[kind];
    if (!id) continue;
    const p = providers.find((x: any) => x.id === id && (x.agent || 'claude') === kind);
    if (!p) continue;
    if (this.applyProviderFor(kind, p)) anyApplied = true;
  }
  return anyApplied;
}

private applyProviderFor(kind: string, p: any): boolean {
  try {
    if (kind === 'claude') {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      let data: Record<string, any> = {};
      try { if (fs.existsSync(settingsPath)) data = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
      if (!data.env) data.env = {};
      Object.assign(data.env, applyClaudeEnv(p));
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
      getLogger().info(`[app] applied provider "${p.name}" to settings.json`);
      return true;
    }
    if (kind === 'codex') {
      const cfgPath = path.join(os.homedir(), '.codex', 'config.toml');
      const existing = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      fs.writeFileSync(cfgPath, mergeCodexConfigToml(existing, p), 'utf8');
      getLogger().info(`[app] applied provider "${p.name}" to codex config.toml`);
      return true;
    }
    if (kind === 'opencode') {
      const cfgPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
      const existing = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      fs.writeFileSync(cfgPath, mergeOpencodeConfig(existing, p), 'utf8');
      getLogger().info(`[app] applied provider "${p.name}" to opencode.json`);
      return true;
    }
    if (kind === 'omp') {
      const modelsPath = path.join(os.homedir(), '.omp', 'agent', 'models.yml');
      const existing = fs.existsSync(modelsPath) ? fs.readFileSync(modelsPath, 'utf8') : null;
      fs.mkdirSync(path.dirname(modelsPath), { recursive: true });
      fs.writeFileSync(modelsPath, mergeOmpModelsYml(existing, p.base_url || '', p.auth_token || undefined), 'utf8');
      getLogger().info(`[app] applied provider "${p.name}" to omp models.yml`);
      return true;
    }
    return false;
  } catch (err: any) {
    getLogger().error(`[app] apply provider "${p.name}" for ${kind} failed: ${err.message}`);
    notifyExternal({ source: 'provider', level: 'error', message: `写入 ${kind} 配置失败，供应商切换未生效: ${errMessage(err)}` });
    return false;
  }
}
```

- [ ] **Step 3: `GetProvidersConfig` 返回前迁移**

`app:getProvidersConfig` handler（app.ts 约 1862-1876 行）末尾改为：

```ts
ipcMain.handle('app:getProvidersConfig', () => {
  const cfg = (this.providersStore.get('config', {}) as Record<string, any>) || {};
  if (!Array.isArray(cfg.providers) || cfg.providers.length === 0) {
    const defaultProvider = this.readDefaultProviderFromSettings();
    const newCfg = {
      active_providers: { claude: defaultProvider.id },
      providers: [defaultProvider],
    };
    this.providersStore.set('config', newCfg);
    getLogger().info('[app] auto-created default provider from settings.json');
    return newCfg;
  }
  return migrateActiveProviders(cfg);
});
```

- [ ] **Step 4: 编译 + 回归**

Run: `npx tsc --noEmit -p tsconfig.json`（主进程编译，等价 `npm run build:electron` 的检查）
Expected: 无类型错误

Run: `npm run test:main`
Expected: 全部通过（含 Task 1 新增测试）

- [ ] **Step 5: Commit**

```bash
git add src/main/app.ts
git commit -m "feat: 供应商激活按 agent 分派写入，兼容迁移 active_provider_id"
```

---

### Task 3: 前端类型 + store per-agent 激活

**Files:**
- Modify: `src/renderer/src/types/providers.ts`
- Modify: `src/renderer/src/stores/providers.ts`

**Interfaces:**
- Consumes: 无（独立于主进程任务）
- Produces:
  - `Provider.codex_provider?: string`、`ProvidersConfig.active_providers?: Record<string, string>`
  - store 新增 `activeIdFor(agent: string): string`；`setActive` / `removeProvider` 写 per-agent；`load` 前端兜底迁移

- [ ] **Step 1: 扩展 `types/providers.ts`**

```ts
export interface Provider {
  id: string
  agent?: string        // 缺省 'claude'
  name: string
  base_url: string
  auth_token: string
  default_model: string
  default_haiku_model?: string
  default_sonnet_model?: string
  default_opus_model?: string
  reasoning_model?: string
  codex_provider?: string   // codex 专属：config.toml 里 model_providers 的 key，默认 'lynel'
}

export interface ProvidersConfig {
  active_providers?: Record<string, string>   // per-agent 激活
  active_provider_id?: string                  // 旧字段，主进程已迁移
  providers: Provider[]
}
```

- [ ] **Step 2: 改造 `stores/providers.ts`**

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Provider, ProvidersConfig } from '../types/providers'
import { GetProvidersConfig, SaveProvidersConfig } from '../composables/useElectron'

function agentOf(p?: { agent?: string }): string { return p?.agent || 'claude' }

function newProvider(agent?: string): Provider {
  return {
    id: crypto.randomUUID(),
    agent,
    name: '新供应商',
    base_url: '',
    auth_token: '',
    default_model: '',
    default_haiku_model: '',
    default_sonnet_model: '',
    default_opus_model: '',
    reasoning_model: '',
    codex_provider: agent === 'codex' ? 'lynel' : undefined,
  }
}

function defaultConfig(): ProvidersConfig {
  const p = newProvider('claude')
  return { active_providers: { claude: p.id }, providers: [p] }
}

export const useProvidersStore = defineStore('providers', () => {
  const cfg = ref<ProvidersConfig | null>(null)
  const dirty = ref(false)

  async function load() {
    cfg.value = await GetProvidersConfig()
    if (!cfg.value || !cfg.value.providers || cfg.value.providers.length === 0) {
      cfg.value = defaultConfig()
      dirty.value = true
      return
    }
    // 前端兜底迁移（主进程通常已迁移）
    if (!cfg.value.active_providers) {
      const claudeId = cfg.value.active_provider_id
        || cfg.value.providers.find(p => agentOf(p) === 'claude')?.id
        || ''
      cfg.value.active_providers = { claude: claudeId }
    }
    dirty.value = false
  }

  async function save() {
    if (!cfg.value) return
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
    dirty.value = false
  }

  function markDirty() { dirty.value = true }

  function activeIdFor(agent: string): string {
    return cfg.value?.active_providers?.[agent] || ''
  }

  async function addProvider(agent?: string): Promise<string> {
    if (!cfg.value) cfg.value = defaultConfig()
    const p = newProvider(agent)
    cfg.value.providers.push(p)
    dirty.value = false
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
    return p.id
  }

  async function removeProvider(id: string): Promise<string> {
    if (!cfg.value) return ''
    const idx = cfg.value.providers.findIndex(p => p.id === id)
    if (idx === -1) return ''
    const agent = agentOf(cfg.value.providers[idx])
    cfg.value.providers.splice(idx, 1)
    if (!cfg.value.active_providers) cfg.value.active_providers = {}
    const remaining = cfg.value.providers.filter(p => agentOf(p) === agent)
    if (remaining.length === 0) {
      // 组内最后一个被删：补一个空 provider 并设为激活（spec 行为细节）
      const p = newProvider(agent)
      cfg.value.providers.push(p)
      cfg.value.active_providers[agent] = p.id
    } else if (cfg.value.active_providers[agent] === id) {
      // 删的是激活项但组内仍有：改选组内第一个
      cfg.value.active_providers[agent] = remaining[0].id
    }
    dirty.value = false
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
    return cfg.value.active_providers[agent] || ''
  }

  async function setActive(id: string) {
    if (!cfg.value) return
    const p = cfg.value.providers.find(x => x.id === id)
    if (!p) return
    if (!cfg.value.active_providers) cfg.value.active_providers = {}
    cfg.value.active_providers[agentOf(p)] = id
    dirty.value = false
    await SaveProvidersConfig(JSON.parse(JSON.stringify(cfg.value)))
  }

  return { cfg, dirty, load, save, markDirty, addProvider, removeProvider, setActive, activeIdFor }
})
```

- [ ] **Step 3: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/types/providers.ts src/renderer/src/stores/providers.ts
git commit -m "feat: providers 数据模型与 store 支持 per-agent 激活"
```

---

### Task 4: `ProviderCard.vue` + `ProviderDialog.vue` 组件

**Files:**
- Create: `src/renderer/src/components/settings/ProviderCard.vue`
- Create: `src/renderer/src/components/settings/ProviderDialog.vue`

**Interfaces:**
- Consumes: store 的 `activeIdFor(agent)`；`useElectron` 的 `TestProviderConnection` / `FetchProviderModels`；`AgentBadge`；`Icon`
- Produces:
  - `ProviderCard` props: `{ provider: Provider, agent: string, isActive: boolean }`；emits: `edit` / `setActive` / `remove`
  - `ProviderDialog` props: `{ modelValue: boolean, provider: Provider | null, agent: string }`；emits: `update:modelValue` / `save(provider: Provider)`

- [ ] **Step 1: 实现 `ProviderCard.vue`**

```vue
<template>
  <div class="provider-card" :class="{ active: isActive }">
    <div class="card-head">
      <span class="name">{{ provider.name || '未命名供应商' }}</span>
      <AgentBadge :agent="(provider.agent || 'claude') as any" size="sm" />
      <span v-if="isActive" class="current-badge">当前</span>
    </div>
    <div class="card-body">
      <div class="url" :title="provider.base_url">{{ provider.base_url || '未设置 Base URL' }}</div>
      <div v-if="provider.default_model" class="model">{{ provider.default_model }}</div>
    </div>
    <div class="card-actions">
      <button v-if="!isActive" class="set-active" @click="$emit('setActive')">设为当前</button>
      <button class="edit" @click="$emit('edit')">编辑</button>
      <button class="remove" @click="$emit('remove')">删除</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import AgentBadge from '../../AgentBadge.vue'
import type { Provider } from '../../types/providers'

defineProps<{
  provider: Provider
  isActive: boolean
}>()

defineEmits<{
  (e: 'edit'): void
  (e: 'setActive'): void
  (e: 'remove'): void
}>()
</script>

<style scoped>
.provider-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.provider-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.card-head { display: flex; align-items: center; gap: 8px; }
.name { flex: 1; font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.current-badge { font-size: 10px; padding: 2px 6px; border-radius: var(--radius-sm); background: var(--accent); color: var(--text-inverse); font-weight: 600; }
.url { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.model { font-size: 11px; color: var(--text-secondary); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-actions { display: flex; gap: 6px; margin-top: 4px; }
.card-actions button {
  flex: 1; padding: 5px 0; font-size: 12px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); cursor: pointer;
}
.card-actions button.set-active { background: var(--accent); border-color: var(--accent); color: var(--text-inverse); }
.card-actions button.remove { color: var(--status-error); border-color: var(--status-error); }
</style>
```

- [ ] **Step 2: 实现 `ProviderDialog.vue`**

```vue
<template>
  <Teleport to="body">
    <div v-if="modelValue" class="dialog-mask" @click.self="$emit('update:modelValue', false)">
      <div class="dialog">
        <div class="dialog-head">
          <h3>{{ provider ? '编辑供应商' : '新增供应商' }}</h3>
          <button class="close" aria-label="关闭" @click="$emit('update:modelValue', false)">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div class="form-group">
          <label>名称</label>
          <input class="v" v-model="form.name" />
        </div>
        <div class="form-group">
          <label>Base URL</label>
          <input class="v" v-model="form.base_url" :placeholder="urlPlaceholder" @input="onUrlOrTokenInput" />
        </div>
        <div class="form-group">
          <label>Auth Token</label>
          <input class="v" type="password" v-model="form.auth_token" @input="onUrlOrTokenInput" />
        </div>
        <div class="form-group">
          <label>默认模型</label>
          <div class="combo-wrap">
            <input class="v" v-model="form.default_model" placeholder="留空则使用默认模型" @focus="activeModelField = 'model'" @blur="onComboBlur" />
            <div v-if="activeModelField === 'model' && availableModels.length > 0" class="combo-dropdown">
              <div v-for="m in availableModels" :key="m" class="combo-option" @mousedown.prevent="form.default_model = m; activeModelField = ''">
                {{ m }}
              </div>
            </div>
          </div>
        </div>

        <!-- claude 专属：模型细分 -->
        <template v-if="agent === 'claude'">
          <div v-for="f in claudeModelFields" :key="f.key" class="form-group">
            <label>{{ f.label }}</label>
            <div class="combo-wrap">
              <input class="v" :value="(form as any)[f.key]" @input="(e: any) => { (form as any)[f.key] = e.target.value; activeModelField = f.key }" @focus="activeModelField = f.key" @blur="onComboBlur" />
              <div v-if="activeModelField === f.key && availableModels.length > 0" class="combo-dropdown">
                <div v-for="m in availableModels" :key="m" class="combo-option" @mousedown.prevent="(form as any)[f.key] = m; activeModelField = ''">
                  {{ m }}
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- codex 专属：Provider 名 -->
        <div v-if="agent === 'codex'" class="form-group">
          <label>Provider 名 <small>model_providers 的 key</small></label>
          <input class="v" v-model="form.codex_provider" placeholder="lynel" />
        </div>

        <div class="dialog-foot">
          <button class="test" :disabled="!form.base_url" @click="onTest">测试连接</button>
          <div class="spacer" />
          <button @click="$emit('update:modelValue', false)">取消</button>
          <button class="save" @click="onSave">保存</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import Icon from '../../Icon.vue'
import type { Provider } from '../../types/providers'
import { TestProviderConnection, FetchProviderModels } from '../../composables/useElectron'
import { pushToast } from '../../composables/useToast'

const props = defineProps<{
  modelValue: boolean
  provider: Provider | null
  agent: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'save', provider: Provider): void
}>()

const claudeModelFields = [
  { key: 'default_haiku_model', label: 'Haiku默认模型' },
  { key: 'default_sonnet_model', label: 'Sonnet默认模型' },
  { key: 'default_opus_model', label: 'Opus默认模型' },
  { key: 'reasoning_model', label: '推理模型' },
]

const urlPlaceholder = props.agent === 'omp' ? 'https://api.deepseek.com' : 'https://api.anthropic.com'

function blank(): Provider {
  return {
    id: props.provider?.id ?? crypto.randomUUID(),
    agent: props.agent,
    name: props.provider?.name ?? '',
    base_url: props.provider?.base_url ?? '',
    auth_token: props.provider?.auth_token ?? '',
    default_model: props.provider?.default_model ?? '',
    default_haiku_model: props.provider?.default_haiku_model ?? '',
    default_sonnet_model: props.provider?.default_sonnet_model ?? '',
    default_opus_model: props.provider?.default_opus_model ?? '',
    reasoning_model: props.provider?.reasoning_model ?? '',
    codex_provider: props.provider?.codex_provider ?? 'lynel',
  }
}

const form = reactive<Provider>(blank())
const availableModels = ref<string[]>([])
const activeModelField = ref('')
let fetchTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.modelValue, (open) => {
  if (open) Object.assign(form, blank())
  activeModelField.value = ''
  availableModels.value = []
})

function onUrlOrTokenInput() {
  if (fetchTimer) clearTimeout(fetchTimer)
  const { base_url, auth_token } = form
  if (!base_url || !auth_token) { availableModels.value = []; return }
  fetchTimer = setTimeout(async () => {
    const r = await FetchProviderModels(base_url, auth_token)
    if (r.ok && r.models?.length) availableModels.value = r.models
  }, 600)
}

function onComboBlur() {
  setTimeout(() => { activeModelField.value = '' }, 150)
}

async function onTest() {
  const r = await TestProviderConnection(form.base_url, form.auth_token, form.default_model)
  if (r.ok) pushToast({ level: 'info', source: 'provider', message: '连接成功', duration: 3000 })
  else pushToast({ level: 'error', source: 'provider', message: '连接失败：' + (r.error || '未知错误'), duration: 5000 })
}

function onSave() {
  emit('save', { ...form })
  emit('update:modelValue', false)
}
</script>

<style scoped>
.dialog-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.dialog {
  width: 520px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
  background: var(--bg-window); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 20px;
}
.dialog-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.dialog-head h3 { margin: 0; font-size: 16px; }
.close { background: none; border: none; color: var(--text-tertiary); cursor: pointer; padding: 4px; }
.form-group { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; }
.form-group label { width: 150px; font-size: 12px; color: var(--text-primary); padding-top: 7px; flex-shrink: 0; }
.form-group label small { display: block; color: var(--text-tertiary); font-size: 11px; margin-top: 2px; }
.form-group input.v {
  flex: 1; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px; color: var(--text-primary);
  font-size: 12px; font-family: inherit;
}
.form-group input.v[type="password"] { font-family: var(--font-mono); }
.combo-wrap { position: relative; flex: 1; }
.combo-dropdown {
  position: absolute; top: 100%; left: 0; right: 0; max-height: 200px; overflow-y: auto;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 0 0 var(--radius-md) var(--radius-md); z-index: 50; box-shadow: var(--shadow-window);
}
.combo-option { padding: 6px 10px; font-size: 12px; cursor: pointer; }
.combo-option:hover { background: var(--accent-soft-bg); color: var(--accent-light); }
.dialog-foot { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.dialog-foot .spacer { flex: 1; }
.dialog-foot button {
  padding: 7px 16px; border-radius: var(--radius-md); font-size: 12px;
  border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); cursor: pointer;
}
.dialog-foot button.save { background: var(--accent); border-color: var(--accent); color: var(--text-inverse); }
.dialog-foot button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
```

- [ ] **Step 3: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/ProviderCard.vue src/renderer/src/components/settings/ProviderDialog.vue
git commit -m "feat: 供应商卡片与编辑对话框组件（cc-switch 风格）"
```

---

### Task 5: `ProviderTab.vue` 重构为顶部工具条 + 卡片网格

**Files:**
- Modify: `src/renderer/src/components/settings/ProviderTab.vue`

**Interfaces:**
- Consumes: `ProviderCard` / `ProviderDialog` / `AgentBadge` / store `activeIdFor` / `AGENT_KINDS`
- Produces: 重构后的 ProviderTab（顶部 AgentSwitch + 卡片网格 + 空状态 + 对话框编排）

- [ ] **Step 1: 重写模板与脚本**

```vue
<template>
  <div class="provider-tab">
    <div class="header">
      <div class="agent-switch">
        <button
          v-for="k in AGENT_KINDS"
          :key="k"
          class="agent-btn"
          :class="['a-' + k, { active: selectedAgent === k }]"
          @click="selectedAgent = k"
        >
          <AgentBadge :agent="k" size="sm" />
        </button>
      </div>
      <button class="add-btn" @click="onAdd">
        <Icon name="plus" :size="14" />
        <span>新增供应商</span>
      </button>
    </div>

    <div v-if="providers.length > 0" class="card-grid">
      <ProviderCard
        v-for="p in providers"
        :key="p.id"
        :provider="p"
        :is-active="p.id === activeId"
        @edit="openEdit(p)"
        @set-active="onSetActive(p.id)"
        @remove="onDelete(p)"
      />
      <button class="add-card" @click="onAdd">
        <Icon name="plus" :size="20" />
      </button>
    </div>
    <div v-else class="empty-state">
      <div class="empty-text">暂无供应商，点击上方「新增供应商」</div>
      <button class="add-card-empty" @click="onAdd">+ 新增供应商</button>
    </div>

    <ProviderDialog
      v-model="dialogOpen"
      :provider="editingProvider"
      :agent="selectedAgent"
      @save="onSave"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import Icon from '../../Icon.vue'
import AgentBadge from '../../AgentBadge.vue'
import ProviderCard from './ProviderCard.vue'
import ProviderDialog from './ProviderDialog.vue'
import { useProvidersStore } from '../../stores/providers'
import { pushToast } from '../../composables/useToast'
import { AGENT_KINDS } from '../../types/agents'
import type { Provider } from '../../types/providers'

const store = useProvidersStore()
const selectedAgent = ref('claude')
const dialogOpen = ref(false)
const editingProvider = ref<Provider | null>(null)

const allProviders = computed(() => store.cfg?.providers ?? [])
const providers = computed(() => allProviders.value.filter(p => (p.agent || 'claude') === selectedAgent.value))
const activeId = computed(() => store.activeIdFor(selectedAgent.value))

onMounted(async () => { await store.load() })

function onAdd() {
  editingProvider.value = null
  dialogOpen.value = true
}

function openEdit(p: Provider) {
  editingProvider.value = p
  dialogOpen.value = true
}

async function onSave(p: Provider) {
  // 新增：push；编辑：按 id 替换
  if (!store.cfg) return
  const idx = store.cfg.providers.findIndex(x => x.id === p.id)
  if (idx === -1) store.cfg.providers.push(p)
  else store.cfg.providers[idx] = p
  try {
    await store.save()
    pushToast({ level: 'info', source: 'provider', message: '保存成功' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '保存失败：' + (e?.message ?? e) })
  }
}

async function onSetActive(id: string) {
  try {
    await store.setActive(id)
    pushToast({ level: 'info', source: 'provider', message: '已切换为当前供应商' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '切换失败：' + (e?.message ?? e) })
  }
}

async function onDelete(p: Provider) {
  if (!confirm(`确定删除供应商「${p.name || '未命名'}」吗？`)) return
  try {
    await store.removeProvider(p.id)
    pushToast({ level: 'info', source: 'provider', message: '已删除' })
  } catch (e: any) {
    pushToast({ level: 'error', source: 'provider', message: '删除失败：' + (e?.message ?? e) })
  }
}
</script>

<style scoped>
.provider-tab { display: flex; flex-direction: column; height: 100%; }
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
}
.agent-switch { display: flex; gap: 6px; }
.agent-btn {
  width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-input); cursor: pointer;
}
.agent-btn:hover { border-color: var(--accent); }
.agent-btn.active { border-color: transparent; }
.agent-btn.a-claude.active { background: var(--agent-claude-bg); }
.agent-btn.a-codex.active { background: var(--agent-codex-bg); }
.agent-btn.a-opencode.active { background: var(--agent-opencode-bg); }
.agent-btn.a-omp.active { background: var(--agent-omp-bg); }
.add-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: var(--radius-md); font-size: 12px;
  border: 1px solid var(--border); background: var(--accent); color: var(--text-inverse); cursor: pointer;
}
.card-grid {
  flex: 1; overflow-y: auto; padding: 16px;
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; align-content: start;
}
.add-card {
  min-height: 96px; border: 1px dashed var(--border); border-radius: var(--radius-md);
  background: transparent; color: var(--text-tertiary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.add-card:hover { border-color: var(--accent); color: var(--accent-light); }
.empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
.empty-text { font-size: 13px; color: var(--text-tertiary); }
.add-card-empty {
  padding: 7px 16px; border-radius: var(--radius-md); font-size: 12px;
  border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); cursor: pointer;
}
</style>
```

- [ ] **Step 2: 删除残留的旧 ProviderTab 样式/逻辑**

确认重构后文件不再引用 `selectedId`、`provider` computed、`onUrlOrTokenInput`、`modelFields` 等旧逻辑（新实现由 ProviderDialog 承担）。运行 grep 确认无 `store.markDirty` 残留（新增在对话框内不即时改 store，保存时统一 save）。

- [ ] **Step 3: 类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/ProviderTab.vue
git commit -m "refactor: ProviderTab 重构为 cc-switch 风格（工具条 + 卡片网格 + 对话框）"
```

---

### Task 6: 回归验证

**Files:** 无新增

**Interfaces:** 无

- [ ] **Step 1: 主进程测试全绿**

Run: `npm run test:main`
Expected: 全部通过

- [ ] **Step 2: 前端类型检查全绿**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 手动验证（可选）**

Run: `npm run dev`，进入设置 → 模型供应商，验证：
- 4 个 agent 切换，每分组显示各自供应商卡片与激活状态
- 新增 codex 供应商（含 Provider 名字段），设为当前 → 检查 `~/.codex/config.toml` 被写入
- 新增 opencode / omp 供应商，设为当前 → 检查 opencode.json / models.yml 被写入
- 老配置（active_provider_id）启动后自动迁移到 claude

- [ ] **Step 4: 收尾（按用户 git 偏好确认后执行）**

```bash
git status
```
确认无未提交改动或按用户要求提交。
