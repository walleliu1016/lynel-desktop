/**
 * 企业微信模板卡片构建器。
 * 负责将 PermissionRequest 与 AskUserQuestion 输入转换为 WeCom template_card 载荷。
 */

import type { PermissionRequest } from '../../permission-broker.js';

export const EVENT_KEY_PREFIX = 'wecom';

/** task_id 只能包含数字、字母和 "_-@"，最长 128 字节 */
function toTaskId(base: string): string {
  return base.replace(/[^0-9a-zA-Z_\-@]/g, '_').slice(0, 128);
}

interface AskOption {
  label: string;
  description?: string;
}

interface AskQuestion {
  header?: string;
  question: string;
  multiSelect?: boolean;
  options: AskOption[];
}

interface AskInput {
  questions?: AskQuestion[];
}

/**
 * 提取工具输入的预览文本，用于在权限卡片中展示命令或路径。
 */
function formatToolInput(toolInput: unknown): string {
  if (toolInput === undefined || toolInput === null) {
    return '';
  }

  if (typeof toolInput === 'object') {
    const input = toolInput as Record<string, unknown>;

    if (input.command) {
      return String(input.command);
    }

    if (input.file_path || input.path) {
      return String(input.file_path || input.path);
    }
  }

  return JSON.stringify(toolInput).slice(0, 200);
}

/**
 * 构建权限请求的 button_interaction 模板卡片。
 * @param sessionTitle 会话标题，显示在卡片来源区域
 */
export function buildPermissionCard(
  req: PermissionRequest,
  seq: number,
  sessionTitle?: string,
): unknown {
  const preview = formatToolInput(req.toolInput);
  const sourceDesc = sessionTitle || 'Lynel';

  return {
    card_type: 'button_interaction',
    source: { desc: sourceDesc, desc_color: 0 },
    main_title: {
      title: '权限请求',
      desc: `${req.toolName}（会话#${seq}）`,
    },
    sub_title_text: preview ? `命令/路径：${preview}` : undefined,
    task_id: toTaskId(req.id),
    button_list: [
      { text: '允许', style: 1, key: `${EVENT_KEY_PREFIX}:allow:${req.id}` },
      { text: '拒绝', style: 4, key: `${EVENT_KEY_PREFIX}:deny:${req.id}` },
    ],
  };
}

/**
 * 构建用户提问的模板卡片。
 * 每个问题独立一张 vote_interaction 卡片（mode 区分单选/多选），
 * 多问题场景下依次发送，事件处理器累积答案后统一 resolve。
 * @param sessionTitle 会话标题，显示在卡片来源区域
 * @param total 问题总数，用于标题展示"问题 N/M"
 */
export function buildAskQuestionCard(
  seq: number,
  input: AskInput,
  requestId?: string,
  sessionTitle?: string,
  total?: number,
): unknown[] {
  const rid = requestId ?? `seq-${seq}`;
  const questions = input.questions ?? [];
  const sourceDesc = sessionTitle || 'Lynel';
  const count = total ?? questions.length;

  if (questions.length === 0) {
    return [];
  }

  return questions.map((q, qIdx) => {
    const modeLabel = q.multiSelect ? '多选' : '单选';
    const titlePrefix = count > 1 ? `问题 ${qIdx + 1}/${count}：` : '';
    return {
      card_type: 'vote_interaction',
      source: { desc: sourceDesc, desc_color: 0 },
      main_title: {
        title: `${titlePrefix}${q.question}`,
        desc: modeLabel,
      },
      task_id: toTaskId(`${rid}-${qIdx}`),
      checkbox: {
        question_key: `${EVENT_KEY_PREFIX}:answer:${rid}:${qIdx}`,
        mode: q.multiSelect ? 1 : 0,
        option_list: q.options.map((option, idx) => ({
          id: `${EVENT_KEY_PREFIX}:opt:${rid}:${qIdx}:${idx}`,
          text: option.description ? `${option.label} - ${option.description}` : option.label,
        })),
      },
      submit_button: {
        text: '提交',
        key: `${EVENT_KEY_PREFIX}:submit:${rid}`,
      },
    };
  });
}
