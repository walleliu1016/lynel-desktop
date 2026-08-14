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

/** 判断一行是否为 TOML 表头（如 [model_providers.x]） */
function isTomlHeader(line: string): boolean {
  const t = line.trim();
  return t.startsWith('[') && t.length > 1 && t.endsWith(']');
}

/**
 * 从 lines 中剔除根级（首个表头之前）已存在的 model / model_provider 键，
 * 避免与稍后新增的顶层键重复（TOML 同一表内键必须唯一）。
 * stripModel 为 false 时保留既有 model（当默认模型为空、不会新增 model 时）。
 */
function stripRootModelKeys(lines: string[], stripModel: boolean): string[] {
  const out: string[] = [];
  let inTable = false;
  for (const raw of lines) {
    if (isTomlHeader(raw)) inTable = true;
    if (!inTable) {
      const t = raw.trim();
      if (stripModel && /^model\s*=/.test(t)) continue;
      if (/^model_provider\s*=/.test(t)) continue;
    }
    out.push(raw);
  }
  return out;
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
  const modelLines: string[] = [];
  if (p.default_model) modelLines.push(`model = "${p.default_model}"`);
  modelLines.push(`model_provider = "${name}"`);

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === header) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    // 无既有同段：保留根级内容（剔除已存在的顶层 model/model_provider），
    // 在首个表头之前插入新的顶层键，避免键重复或被后续表头吞并。
    const preserved = stripRootModelKeys(lines.filter((l) => l.trim()), Boolean(p.default_model));
    const root: string[] = [];
    const rest: string[] = [];
    let inTable = false;
    for (const raw of preserved) {
      if (isTomlHeader(raw)) inTable = true;
      if (inTable) rest.push(raw);
      else root.push(raw);
    }
    out.push(...root, ...modelLines, '', ...rest, ...newSeg);
    return out.join('\n') + '\n';
  }
  let segEnd = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (isTomlHeader(lines[i])) { segEnd = i; break; }
  }
  out.push(...stripRootModelKeys(lines.slice(0, headerIdx), Boolean(p.default_model)));
  out.push(...modelLines, '');
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
