// AgentKind：与主进程 src/main/agents/types.ts 对齐
export type AgentKind = 'claude' | 'codex' | 'opencode' | 'omp'

export interface AgentMeta {
  kind: AgentKind
  label: string     // 完整名（tooltip/loading 用）
  short: string     // 下拉显示名
  abbr: string      // badge 缩写
  bgVar: string     // theme.css CSS 变量名
  fgVar: string
  tagline: string
}

export const AGENT_KINDS: AgentKind[] = ['claude', 'codex', 'opencode', 'omp']

export const AGENT_META: Record<AgentKind, AgentMeta> = {
  claude:   { kind: 'claude', label: 'Claude Code', short: 'Claude', abbr: 'CC', bgVar: '--agent-claude-bg', fgVar: '--agent-claude-fg', tagline: 'Anthropic 官方 CLI' },
  codex:    { kind: 'codex', label: 'Codex', short: 'Codex', abbr: 'CX', bgVar: '--agent-codex-bg', fgVar: '--agent-codex-fg', tagline: 'OpenAI CLI' },
  opencode: { kind: 'opencode', label: 'OpenCode', short: 'OpenCode', abbr: 'OC', bgVar: '--agent-opencode-bg', fgVar: '--agent-opencode-fg', tagline: 'SST 开源' },
  omp:      { kind: 'omp', label: 'OMP', short: 'OMP', abbr: 'PI', bgVar: '--agent-omp-bg', fgVar: '--agent-omp-fg', tagline: 'oh-my-pi' },
}

/** 未知/缺省 agent 一律回退 claude（老会话向后兼容） */
export function agentMeta(agent?: string | null): AgentMeta {
  if (agent && Object.hasOwn(AGENT_META, agent) && AGENT_META[agent as AgentKind]) return AGENT_META[agent as AgentKind]
  return AGENT_META.claude
}
