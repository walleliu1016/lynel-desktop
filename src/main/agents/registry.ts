// Agent 注册表：描述每个终端 agent 的启动/注入/session 发现/权限/退出命令差异。
// 参考 ccglass 的 providers.js（envVar/upstream 映射）。app.ts 通过 agentSpec(kind) 取用。

import type { AgentKind, AgentSpec } from './types.js';
import { anthropicAdapter } from '../formats/anthropic.js';
import { openaiAdapter } from '../formats/openai.js';

const claudeExit: AgentSpec['exitCommands'] = {
  '/exit': 'exit',
  'exit': 'exit',
  '/quit': 'exit',
  'quit': 'exit',
  '/clear': 'clear',
  '/resume': 'resume',
};

const codexExit: AgentSpec['exitCommands'] = {
  '/exit': 'exit',
  '/quit': 'exit',
  '/new': 'clear',
};

const opencodeExit: AgentSpec['exitCommands'] = {
  '/exit': 'exit',
  '/quit': 'exit',
  '/q': 'exit',
  '/new': 'clear',
  '/clear': 'clear',
};

const ompExit: AgentSpec['exitCommands'] = {
  '/quit': 'exit',
  '/q': 'exit',
  '/clear': 'clear',
  '/new': 'clear',
  '/resume': 'resume',
};

export const AGENTS: Record<AgentKind, AgentSpec> = {
  claude: {
    kind: 'claude',
    label: 'Claude Code',
    command: 'claude',
    format: anthropicAdapter,
    envVar: 'ANTHROPIC_BASE_URL',
    sessionStrategy: 'pregen',
    permission: 'claude-hook',
    exitCommands: claudeExit,
    upstream: 'https://api.anthropic.com',
    probe: true,
  },
  codex: {
    kind: 'codex',
    label: 'Codex (OpenAI)',
    command: 'codex',
    format: openaiAdapter,
    envVar: 'OPENAI_BASE_URL', // env 兜底注入（config.toml 的 -c 覆盖为主，对齐 ccglass 双保险）
    configTemplate: 'codex-toml',
    sessionStrategy: 'codex-exec',
    permission: 'codex-hook',
    exitCommands: codexExit,
    upstream: 'https://api.openai.com',
  },
  opencode: {
    kind: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    format: openaiAdapter,
    // envVar 移除：OPENAI_BASE_URL 只对 openai provider 生效，而 opencode 默认 provider 是
    // opencode-go（opencode.ai 官方网关），必须用 OPENCODE_CONFIG 覆盖 provider.opencode-go.options.baseURL
    // （buildAgentInjection 写临时配置文件，已实测 raw 收到 POST /chat/completions）。
    configTemplate: 'opencode-json',
    sessionStrategy: 'opencode-serve',
    permission: 'opencode-plugin',
    exitCommands: opencodeExit,
    // opencode-go 官方网关默认 base_url（代理转发目标）；此前留空回退 api.openai.com 导致上游错误
    upstream: 'https://opencode.ai/zen/go/v1',
  },
  omp: {
    kind: 'omp',
    label: 'OMP (oh-my-pi)',
    command: 'omp',
    // deepseek provider 走 openai-completions 协议（omp 内置模型表 + 内置 base_url）；
    // Anthropic/其他 provider 的分派留待后续（当前按 deepseek 适配）
    format: openaiAdapter,
    // envVar 移除：deepseek provider 的 base_url 内置，env 无法覆盖。
    // 写 ~/.omp/agent/models.yml override-only provider 覆盖 providers.deepseek.baseUrl（buildAgentInjection）。
    // 注：`--config` overlay 只合并 settings schema、不合并 models.yml 的 providers 段（已实测 raw 证伪），
    // 必须写全局 models.yml 并在 session 退出时恢复原文件。
    sessionStrategy: 'omp-jsonl',
    permission: 'omp-hook',
    exitCommands: ompExit,
    upstream: 'https://api.deepseek.com',
  },
};

export function agentSpec(kind: AgentKind | undefined | null): AgentSpec {
  if (kind && AGENTS[kind]) return AGENTS[kind];
  return AGENTS.claude;
}

/** 按 settings 判断某 agent 是否启用：claude 恒启用，codex/opencode/omp 读 `<kind>_enabled` 开关（缺省关闭） */
export function isAgentEnabledBySettings(settings: { get(key: string, defaultValue?: unknown): unknown }, kind: AgentKind): boolean {
  if (kind === 'claude') return true;
  return !!settings.get(`${kind}_enabled`, false);
}
