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

/** 下次运行文案（面向未来）：任务列表的第二行与详情页的「下次运行」共用。
 *  不能复用 utils/time.ts 的 formatRelTime —— 那是「过去多久」的口径，
 *  传未来时间戳进去只会得到「刚刚」；且它只接受 ISO 字符串。 */
export function formatNextRun(ms: number): string {
  const diff = ms - Date.now();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '即将运行';
  if (min < 60) return `${min} 分钟后`;
  const d = new Date(ms);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dayOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayOf(d) - dayOf(new Date())) / 86400000);
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `明天 ${hm}`;
  if (days > 1 && days < 7) {
    return `${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]} ${hm}`;
  }
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${md} ${hm}`;
}

/** 运行时长文案（运行历史的时长列与运行流水共用）。
 *  口径照设计稿的运行历史行：按「分秒」展示 —— 12s 那次失败写作 `0m12s`、2m18s 写作 `2m18s`、
 *  30 分钟超时写作 `30m00s`；满一小时折叠成 `1h05m`（分钟位补零）。
 *  入参非法（NaN / Infinity / 负数）时返回占位符，不抛错。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
    return `${m}m${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
  return `${h}h${m}m`;
}

/** 取第一行非空文本（多行结果 / 报错只展示首行）。 */
function firstLine(text: string | null): string {
  return (text ?? '').split('\n').find((l) => l.trim() !== '') ?? '';
}

/** 运行历史一行的摘要文案。 */
export function runSummaryText(resultText: string | null, error: string | null, status: string): string {
  if (status === 'queued') return '排队中';
  if (status === 'running') return '—';
  if (status === 'skipped') return error ?? '排队超时未启动';
  if (status === 'interrupted') return error ?? '已中断';
  if (status === 'timeout') return error ?? '超过 30 分钟上限';
  // 主进程只在「没有 result 事件」时才写 runs.error；有 result 且 is_error 时
  // （error_max_turns、API 报错）真正的原因在 result_text 里、error 为 null ——
  // 不兜这一层，这些历史行全部退化成通用的「执行失败」，真实原因被丢掉。
  if (status === 'error') {
    const first = firstLine(resultText);
    return error ?? (first ? first.slice(0, 120) : '执行失败');
  }
  return firstLine(resultText).slice(0, 120);
}
