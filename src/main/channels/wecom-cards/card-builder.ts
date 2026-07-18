/**
 * 企业微信模板卡片构建器。
 * 负责将 PermissionRequest 与 AskUserQuestion 输入转换为 WeCom template_card 载荷。
 */

import type { PermissionRequest } from '../../permission-broker.js';

export const EVENT_KEY_PREFIX = 'wecom';

export interface AskOption {
  label: string;
  description?: string;
}

export interface AskQuestion {
  header?: string;
  question: string;
  multiSelect?: boolean;
  options: AskOption[];
}

export interface AskInput {
  questions?: AskQuestion[];
}

/**
 * 提取工具输入的预览文本，用于在权限卡片中展示命令或路径。
 */
function formatToolInput(toolInput: unknown): string {
  if (typeof toolInput !== 'object' || toolInput === null) {
    return '';
  }

  const input = toolInput as Record<string, unknown>;

  if ('command' in input && input.command !== undefined) {
    return String(input.command);
  }

  if ('file_path' in input && input.file_path !== undefined) {
    return String(input.file_path);
  }

  if ('path' in input && input.path !== undefined) {
    return String(input.path);
  }

  return JSON.stringify(toolInput).slice(0, 200);
}

/**
 * 构建权限请求的 button_interaction 模板卡片。
 */
export function buildPermissionCard(req: PermissionRequest, seq: number): unknown {
  const preview = formatToolInput(req.toolInput);

  return {
    card_type: 'button_interaction',
    source: { desc: 'Lynel', desc_color: 0 },
    main_title: {
      title: '🔒 权限请求',
      desc: `${req.toolName}（会话#${seq}）`,
    },
    sub_title_text: preview ? `命令/路径：${preview}` : undefined,
    button_list: [
      { text: '允许', style: 1, key: `${EVENT_KEY_PREFIX}:allow:${req.id}` },
      { text: '拒绝', style: 4, key: `${EVENT_KEY_PREFIX}:deny:${req.id}` },
    ],
  };
}

/**
 * 构建用户提问的模板卡片。
 * 单问题单选使用 vote_interaction，多问题或多选使用 multiple_interaction。
 */
export function buildAskQuestionCard(seq: number, input: AskInput, requestId?: string): unknown {
  const rid = requestId ?? `seq-${seq}`;
  const questions = input.questions ?? [];
  const singleQuestion = questions.length === 1 ? questions[0] : undefined;
  const isSingleVote = singleQuestion !== undefined && !singleQuestion.multiSelect;

  if (isSingleVote) {
    return {
      card_type: 'vote_interaction',
      main_title: {
        title: `❓ ${singleQuestion.header ?? 'Claude 提问（1个问题）'}`,
        desc: singleQuestion.question,
      },
      checkbox: {
        question_key: `${EVENT_KEY_PREFIX}:answer:${rid}:0`,
        mode: 0,
        option_list: singleQuestion.options.map((option, idx) => ({
          id: `${EVENT_KEY_PREFIX}:opt:${rid}:0:${idx}`,
          text: option.label,
        })),
      },
      submit_button: {
        text: '提交',
        key: `${EVENT_KEY_PREFIX}:submit:${rid}`,
      },
    };
  }

  return {
    card_type: 'multiple_interaction',
    main_title: {
      title: `❓ ${singleQuestion?.header ?? `Claude 提问（${questions.length}个问题）`}`,
    },
    select_list: questions.map((q, qIdx) => ({
      question_key: `${EVENT_KEY_PREFIX}:answer:${rid}:${qIdx}`,
      title: q.header ?? q.question,
      option_list: q.options.map((option, oIdx) => ({
        id: `${EVENT_KEY_PREFIX}:opt:${rid}:${qIdx}:${oIdx}`,
        text: option.label,
      })),
    })),
    submit_button: {
      text: '提交',
      key: `${EVENT_KEY_PREFIX}:submit:${rid}`,
    },
  };
}
