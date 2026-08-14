// AgentKind：终端 AI 编码代理类型。
// 每个 agent 用不同二进制启动、不同 env/配置指向本地代理、不同方式发现 session id、
// 不同机制做权限审批。AgentSpec 集中描述这些差异，供 app.ts 分派。

import type { FormatAdapter } from '../formats/format.js';

export type AgentKind = 'claude' | 'codex' | 'opencode' | 'omp';

/** 权限审批策略。三种新 agent 都无法复刻 Claude 的"全工具同步阻塞"覆盖度，
 *  见 docs/superpowers/specs/2026-08-09-multi-agent-support-design.md 第 5 节。 */
export type PermissionStrategy =
  | 'claude-hook'       // PermissionRequest http hook，全工具（现状）
  | 'codex-hook'        // hooks.json + codex_hooks，仅 shell 工具、deny-only
  | 'opencode-plugin'   // TS 插件 tool.execute.before / permission.ask，不覆盖 MCP/子代理
  | 'omp-hook';         // pi.on('tool_call') JS hook，approvalMode 需非 yolo

/** 如何把"启动时预生成的临时 id"换成 agent 真实 session id。 */
export type SessionStrategy =
  | 'pregen'            // claude：--session-id <uuid> 直接注入，无需发现
  | 'codex-exec'        // codex exec --json 的 thread.started / 轮询 rollout 文件
  | 'opencode-serve'    // opencode serve REST POST /session 返回 id / session.created 事件
  | 'omp-jsonl';        // 读 ~/.omp/agent/sessions/<cwd>/<ts>_<uuidv7>.jsonl 文件名

/** exit-detect 命令映射：PTY 输入行 → 语义。
 *  key 是完整命令行（trim 后精确匹配），value 是语义：
 *  'exit' 结束 session；'clear' 开新会话（不 rebind）；'resume' 切换历史会话。 */
export type ExitCommandMap = Record<string, 'exit' | 'clear' | 'resume'>;

export interface AgentSpec {
  kind: AgentKind;
  label: string;
  /** 启动的可执行文件默认名；app.ts 对 claude 仍优先用 claude_path 设置 */
  command: string;
  /** trace 格式适配器（请求解析 / SSE 重组 / 成本） */
  format: FormatAdapter;
  /** 让客户端指向本地代理的 env 变量名；codex 用临时 config.toml 则无 */
  envVar?: string;
  /** 代理启动后注入方式的模板类型（预留：codex-toml / opencode-json） */
  configTemplate?: 'codex-toml' | 'opencode-json';
  /** session id 发现策略 */
  sessionStrategy: SessionStrategy;
  /** 权限审批策略 */
  permission: PermissionStrategy;
  /** exit-detect 命令映射 */
  exitCommands: ExitCommandMap;
  /** 上游默认地址；'' 表示从当前 env 自动解析 */
  upstream: string;
  /** 是否需要同步 probe（--version）；claude 专属探测对通用 binary 会误判 */
  probe?: boolean;
}
