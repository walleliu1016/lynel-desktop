/**
 * 企业微信模板卡片事件处理器。
 * 解析 template_card_event 回调，驱动权限仲裁器完成审批或问答提交。
 */

import { permissionBroker, type PermissionRequest } from '../../permission-broker.js';
import { WeComCardStore } from './card-store.js';

export interface TemplateCardEventFrame {
  body: {
    chatid?: string;
    from?: { userid?: string };
    event: {
      eventtype: string;
      event_key: string;
      selected_items?: Array<{
        question_key: string;
        option_ids?: string[];
        option_names?: string[];
      }>;
    };
  };
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

const HINT_ALREADY_HANDLED = '该请求已被处理或已过期，请勿重复操作。';
const HINT_UNRECOGNISED_KEY = '无法识别的卡片操作。';
const HINT_UNSUPPORTED_ACTION = '不支持的卡片操作。';
const HINT_NO_SELECTION = '未选择任何选项';

export class WeComCardEventHandler {
  constructor(
    private store: WeComCardStore,
    private sendReply: (chatId: string, text: string) => Promise<void>,
    private updateCard: (msgid: string, card: unknown) => Promise<void>,
  ) {}

  async handle(frame: TemplateCardEventFrame): Promise<void> {
    try {
      const chatId = frame.body.chatid ?? frame.body.from?.userid;
      if (!chatId) {
        return;
      }

      const parsed = this.parseEventKey(frame.body.event.event_key);
      if (!parsed) {
        await this.sendReply(chatId, HINT_UNRECOGNISED_KEY);
        return;
      }

      const { action, requestId } = parsed;
      const state = this.store.get(requestId);
      if (!state || state.status !== 'pending') {
        await this.sendReply(chatId, HINT_ALREADY_HANDLED);
        return;
      }

      if (action === 'allow' || action === 'deny') {
        const ok = permissionBroker.resolve(requestId, action, 'wecom');
        if (ok) {
          this.store.resolve(requestId, action);
          await this.updateOrNotify(requestId, chatId, action);
        } else {
          await this.sendReply(chatId, HINT_ALREADY_HANDLED);
        }
        return;
      }

      if (action === 'submit' || action === 'answer') {
        const pending = permissionBroker.listPending().find((p) => p.id === requestId);
        if (!pending) {
          await this.sendReply(chatId, HINT_ALREADY_HANDLED);
          return;
        }

        const answers = this.buildAnswers(requestId, pending.request, frame.body.event.selected_items);
        if (answers instanceof Error) {
          await this.sendReply(chatId, answers.message);
          return;
        }

        const ok = permissionBroker.resolve(requestId, 'allow', 'wecom', answers);
        if (ok) {
          this.store.resolve(requestId, 'allow', answers);
          await this.updateOrNotify(requestId, chatId, 'allow');
        } else {
          await this.sendReply(chatId, HINT_ALREADY_HANDLED);
        }
        return;
      }

      await this.sendReply(chatId, HINT_UNSUPPORTED_ACTION);
    } catch {
      // 主进程未捕获异常会导致窗口白屏，事件处理失败应静默消化
    }
  }

  private parseEventKey(eventKey: string): { action: string; requestId: string } | undefined {
    const parts = eventKey.split(':');
    if (parts.length < 3 || parts[0] !== 'wecom') {
      return undefined;
    }
    const action = parts[1];
    const requestId = parts.slice(2).join(':');
    if (!action || !requestId) {
      return undefined;
    }
    return { action, requestId };
  }

  private buildAnswers(
    requestId: string,
    req: PermissionRequest,
    selectedItems?: TemplateCardEventFrame['body']['event']['selected_items'],
  ): Record<string, string | string[]> | Error {
    if (!selectedItems || selectedItems.length === 0) {
      return new Error(HINT_NO_SELECTION);
    }

    const input = (req.toolInput ?? {}) as AskInput;
    const questions = input.questions ?? [];
    const answers: Record<string, string | string[]> = {};

    for (const item of selectedItems) {
      const qIdx = this.extractIndex(item.question_key, 3, 0);
      const question = questions[qIdx];
      if (!question) {
        continue;
      }

      const optionIds = item.option_ids ?? [];
      const labels: string[] = [];
      for (const optionId of optionIds) {
        const oIdx = this.extractIndex(optionId, 4, 0);
        const option = question.options[oIdx];
        if (option) {
          labels.push(option.label);
        }
      }

      if (labels.length === 0) {
        continue;
      }

      answers[question.question] = question.multiSelect ? labels : labels[0];
    }

    if (Object.keys(answers).length === 0) {
      return new Error(HINT_NO_SELECTION);
    }

    return answers;
  }

  private extractIndex(key: string, segmentIndex: number, defaultValue: number): number {
    const parts = key.split(':');
    if (parts.length <= segmentIndex) {
      return defaultValue;
    }
    const raw = parts[segmentIndex];
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  private async updateOrNotify(requestId: string, chatId: string, decision: 'allow' | 'deny'): Promise<void> {
    const state = this.store.get(requestId);
    if (!state) {
      return;
    }

    const text = decision === 'allow' ? '已批准该权限请求。' : '已拒绝该权限请求。';
    try {
      await this.updateCard(state.msgid, {
        card_type: 'text_notice',
        source: { desc: 'Lynel', desc_color: 0 },
        main_title: { title: text },
      });
    } catch {
      await this.sendReply(chatId, text);
    }
  }
}
