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
    envVar: 'OPENAI_BASE_URL',
    configTemplate: 'opencode-json',
    sessionStrategy: 'opencode-serve',
    permission: 'opencode-plugin',
    exitCommands: opencodeExit,
    upstream: '', // auto：从当前 env 解析
  },
  omp: {
    kind: 'omp',
    label: 'OMP (oh-my-pi)',
    command: 'omp',
    format: anthropicAdapter, // omp Anthropic provider 直读 ANTHROPIC_BASE_URL；OpenAI provider 走 openaiAdapter（后续按 provider 分派）
    envVar: 'ANTHROPIC_BASE_URL',
    sessionStrategy: 'omp-jsonl',
    permission: 'omp-hook',
    exitCommands: ompExit,
    upstream: 'https://api.anthropic.com',
  },
};

export function agentSpec(kind: AgentKind | undefined | null): AgentSpec {
  if (kind && AGENTS[kind]) return AGENTS[kind];
  return AGENTS.claude;
}
