// src/renderer/src/utils/tasks.ts
// 纯函数：把主进程归一化后的事件流折叠成可渲染的线性条目。
// 不解析 NDJSON —— 那已经在主进程 streamParse 里做过（两个 bundle 无法共享代码）。
import type {
  EventEnvelope, NormalizedBlockDto, NormalizedEventDto, StreamItem,
} from '../types/tasks';

function firstString(v: Record<string, unknown>): string {
  for (const value of Object.values(v)) {
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function countLines(s: string): number {
  return s === '' ? 0 : s.split('\n').length;
}

/** 工具卡片一行的摘要。默认折叠，靠它辨认「这步在干嘛」。 */
export function toolSummary(name: string, input: Record<string, unknown>): string {
  const s = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (name) {
    case 'Bash':
      return s('command');
    case 'Read': {
      const file = s('file_path');
      const offset = typeof input.offset === 'number' ? input.offset : null;
      const limit = typeof input.limit === 'number' ? input.limit : null;
      if (file && offset !== null) {
        return limit !== null ? `${file}:${offset}-${offset + limit - 1}` : `${file}:${offset}+`;
      }
      return file;
    }
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return s('file_path');
    case 'Glob':
      return s('pattern');
    case 'Grep': {
      const pattern = s('pattern');
      const dir = s('path');
      if (!pattern) return dir;
      return dir ? `${pattern} in ${dir}` : pattern;
    }
    case 'TodoWrite':
      return Array.isArray(input.todos) ? `${input.todos.length} 项任务` : '';
    case 'Task':
      return s('description') || s('subagent_type');
    case 'WebFetch':
      return s('url');
    case 'WebSearch':
      return s('query');
    case 'NotebookEdit':
      return s('notebook_path');
    case 'AskUserQuestion': {
      const qs = input.questions;
      if (Array.isArray(qs) && qs.length > 0) {
        const q = qs[0] as Record<string, unknown>;
        if (typeof q?.question === 'string') return q.question;
      }
      return '';
    }
    default:
      return firstString(input);
  }
}

function editDelta(input: Record<string, unknown>): { add: number; del: number } | undefined {
  const oldS = typeof input.old_string === 'string' ? input.old_string : null;
  const newS = typeof input.new_string === 'string' ? input.new_string : null;
  if (oldS === null && newS === null) {
    const content = typeof input.content === 'string' ? input.content : null;
    if (content !== null) return { add: countLines(content), del: 0 };
    return undefined;
  }
  return { add: countLines(newS ?? ''), del: countLines(oldS ?? '') };
}

export function flattenRunEvents(events: NormalizedEventDto[] | EventEnvelope[]): StreamItem[] {
  const list: NormalizedEventDto[] = (events as unknown[]).map((e) =>
    e && typeof e === 'object' && 'event' in (e as object)
      ? (e as EventEnvelope).event
      : (e as NormalizedEventDto),
  );

  const out: StreamItem[] = [];
  /** toolUseId → 在 out 里的下标，用于回填 tool_result */
  const toolIndex = new Map<string, number>();

  for (const ev of list) {
    switch (ev.type) {
      case 'system': {
        if (ev.subtype === 'init' && ev.init) {
          out.push({
            kind: 'init',
            model: ev.init.model,
            cwd: ev.init.cwd,
            toolCount: ev.init.toolCount,
            version: ev.init.claudeCodeVersion,
            failedMcpServers: ev.init.failedMcpServers,
          });
        } else if (ev.hook) {
          out.push({ kind: 'hook', name: ev.hook.name, ok: ev.hook.ok });
        }
        break;
      }
      case 'assistant': {
        // C1：同一 message.id 的多个 block 本来就分散在多行里，按到达顺序展开即可；
        // 空 thinking 已在主进程过滤，这里再兜一层。
        for (const b of (ev.blocks ?? []) as NormalizedBlockDto[]) {
          if (b.type === 'thinking') {
            if (b.text) out.push({ kind: 'thinking', text: b.text });
          } else if (b.type === 'text') {
            if (b.text) out.push({ kind: 'text', text: b.text });
          } else {
            const delta = b.name === 'Edit' || b.name === 'Write' ? editDelta(b.input) : undefined;
            const item: StreamItem = {
              kind: 'tool',
              id: b.id,
              name: b.name,
              summary: toolSummary(b.name, b.input),
              status: 'running',
              input: b.input,
              subagent: ev.parentToolUseId != null,
              ...(delta ? { delta } : {}),
            };
            toolIndex.set(b.id, out.length);
            out.push(item);
          }
        }
        break;
      }
      case 'user': {
        const tr = ev.toolResult;
        if (!tr) break;
        const at = toolIndex.get(tr.toolUseId);
        if (at === undefined) {
          // 配对不上的 tool_result 仍然展示，不能静默丢
          out.push({ kind: 'text', text: tr.content });
          break;
        }
        const current = out[at] as Extract<StreamItem, { kind: 'tool' }>;
        out[at] = {
          ...current,
          status: tr.isError ? 'error' : 'ok',
          output: tr.content,
        };
        break;
      }
      case 'stderr':
        out.push({ kind: 'stderr', text: ev.text ?? '' });
        break;
      case 'result':
        if (ev.result) out.push({ kind: 'result', summary: ev.result });
        break;
      default:
        break;
    }
  }

  return out;
}

/** 运行历史一行的摘要文案。 */
export function runSummaryText(resultText: string | null, error: string | null, status: string): string {
  if (status === 'queued') return '排队中';
  if (status === 'running') return '—';
  if (status === 'skipped') return error ?? '排队超时未启动';
  if (status === 'interrupted') return error ?? '已中断';
  if (status === 'timeout') return error ?? '超过 30 分钟上限';
  if (status === 'error') return error ?? '执行失败';
  const first = (resultText ?? '').split('\n').find((l) => l.trim() !== '') ?? '';
  return first.slice(0, 120);
}
