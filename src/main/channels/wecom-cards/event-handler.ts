/**
 * 企业微信模板卡片事件处理器。
 * 解析 template_card_event 回调，驱动权限仲裁器完成审批或问答提交。
 */

import { permissionBroker, type PermissionRequest } from '../../permission-broker.js';
import { WeComCardStore } from './card-store.js';
import { getLogger } from '../../log.js';

const logger = getLogger().scope('wecom-card-event-handler');

/** WeCom template_card_event 中 selected_items 的单条记录 */
interface SelectedItem {
  question_key: string;
  option_ids?: { option_id?: string[] };
}

/** WeCom template_card_event 的 template_card_event 子对象 */
interface TemplateCardEventPayload {
  event_key?: string;
  task_id?: string;
  card_type?: string;
  selected_items?: {
    selected_item?: SelectedItem[];
  };
}

export interface TemplateCardEventFrame {
  body: {
    chatid?: string;
    from?: { userid?: string };
    event: {
      eventtype: string;
      template_card_event: TemplateCardEventPayload;
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
  private onQuestionProgress?: (requestId: string, nextQIdx: number, chatId: string) => Promise<void>;
  private onAllQuestionsDone?: (requestId: string, chatId: string, answers: Record<string, string | string[]>, questions: AskQuestion[]) => Promise<void>;

  constructor(
    private store: WeComCardStore,
    private sendReply: (chatId: string, text: string, requestId?: string) => Promise<void>,
    private updateCard: (frame: TemplateCardEventFrame, card: unknown) => Promise<void>,
    callbacks?: {
      onQuestionProgress?: (requestId: string, nextQIdx: number, chatId: string) => Promise<void>;
      onAllQuestionsDone?: (requestId: string, chatId: string, answers: Record<string, string | string[]>, questions: AskQuestion[]) => Promise<void>;
    },
  ) {
    if (callbacks) {
      this.onQuestionProgress = callbacks.onQuestionProgress;
      this.onAllQuestionsDone = callbacks.onAllQuestionsDone;
    }
  }

  async handle(frame: TemplateCardEventFrame): Promise<void> {
    try {
      logger.info('[wecom-card-event-handler] 收到卡片事件: %s', JSON.stringify(frame.body).slice(0, 500));
      const chatId = frame.body.chatid ?? frame.body.from?.userid;
      if (!chatId) {
        logger.warn('[wecom-card-event-handler] 无法获取 chatId');
        return;
      }

      const tce = frame.body.event.template_card_event;
      const rawKey = tce?.event_key;
      logger.info('[wecom-card-event-handler] event_key=%s', rawKey);
      const parsed = this.parseEventKey(rawKey);
      if (!parsed) {
        await this.sendReply(chatId, HINT_UNRECOGNISED_KEY);
        return;
      }

      const { action, requestId } = parsed;
      const state = this.store.get(requestId);
      if (!state || state.status !== 'pending') {
        await this.sendReply(chatId, HINT_ALREADY_HANDLED, requestId);
        return;
      }

      if (action === 'allow' || action === 'deny') {
        const ok = permissionBroker.resolve(requestId, action, 'wecom');
        if (ok) {
          this.store.resolve(requestId, action);
          await this.updateOrNotify(requestId, chatId, action, frame);
        } else {
          await this.sendReply(chatId, HINT_ALREADY_HANDLED, requestId);
        }
        return;
      }

      if (action === 'submit' || action === 'answer') {
        const pending = permissionBroker.listPending().find((p) => p.id === requestId);
        if (!pending) {
          await this.sendReply(chatId, HINT_ALREADY_HANDLED, requestId);
          return;
        }

        const answers = this.buildAnswers(requestId, pending.request, tce?.selected_items);
        if (answers instanceof Error) {
          await this.sendReply(chatId, answers.message, requestId);
          return;
        }

        // 检查是否为多问题场景（需要累积答案）
        const input = (pending.request.toolInput ?? {}) as AskInput;
        const questions = input.questions ?? [];
        if (questions.length > 1) {
          // 多卡片：提取问题索引，记录部分答案
          const qIdx = this.extractQuestionIndex(tce?.selected_items);
          logger.info('[wecom-card-event-handler] multi-question submit: qIdx=%d total=%d', qIdx, questions.length);
          if (qIdx >= 0) {
            const allDone = this.store.recordAnswer(requestId, qIdx, questions.length, Object.values(answers)[0]);
            logger.info('[wecom-card-event-handler] multi-question: qIdx=%d allDone=%s', qIdx, allDone);
            // 更新已提交的卡片为"已选择"状态
            await this.updateSubmittedCard(requestId, qIdx, frame);
            if (allDone) {
              const accumulated = this.store.getAccumulatedAnswers(requestId, questions);
              const ok = permissionBroker.resolve(requestId, 'allow', 'wecom', accumulated);
              if (ok) {
                this.store.resolve(requestId, 'allow', accumulated);
                await this.onAllQuestionsDone?.(requestId, chatId, accumulated, questions);
              }
            } else {
              // 还有未答题目，通知发送下一张卡片
              logger.info('[wecom-card-event-handler] calling onQuestionProgress for qIdx=%d', qIdx + 1);
              await this.onQuestionProgress?.(requestId, qIdx + 1, chatId);
            }
          }
          return;
        }

        // 单问题：直接 resolve
        const ok = permissionBroker.resolve(requestId, 'allow', 'wecom', answers);
        if (ok) {
          this.store.resolve(requestId, 'allow', answers);
          await this.updateOrNotify(requestId, chatId, 'allow', frame);
        } else {
          await this.sendReply(chatId, HINT_ALREADY_HANDLED, requestId);
        }
        return;
      }

      await this.sendReply(chatId, HINT_UNSUPPORTED_ACTION, requestId);
    } catch (err) {
      logger.error('[wecom-card-event-handler] 处理卡片事件失败:', err);
    }
  }

  private parseEventKey(eventKey: string | undefined): { action: string; requestId: string } | undefined {
    if (!eventKey) return undefined;
    const parts = eventKey.split(':');
    if (parts.length < 3 || parts[0] !== 'wecom') {
      return undefined;
    }
    const action = parts[1];
    const requestId = parts[2];
    if (!action || !requestId) {
      return undefined;
    }
    return { action, requestId };
  }

  private buildAnswers(
    requestId: string,
    req: PermissionRequest,
    selectedItemsPayload?: TemplateCardEventPayload['selected_items'],
  ): Record<string, string | string[]> | Error {
    const selectedItems = selectedItemsPayload?.selected_item ?? [];
    logger.info('[wecom-card-event-handler] buildAnswers: selectedItems=%s', JSON.stringify(selectedItems).slice(0, 500));
    if (selectedItems.length === 0) {
      logger.warn('[wecom-card-event-handler] buildAnswers: empty selected_items, raw=%s', JSON.stringify(selectedItemsPayload ?? 'undefined').slice(0, 500));
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

      const optionIds = item.option_ids?.option_id ?? [];
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

  /** 从 selected_items 中提取第一个选项的问题索引 */
  private extractQuestionIndex(selectedItemsPayload?: TemplateCardEventPayload['selected_items']): number {
    const items = selectedItemsPayload?.selected_item ?? [];
    if (items.length === 0) return -1;
    return this.extractIndex(items[0].question_key, 3, -1);
  }

  /** 多卡片场景：将已提交的卡片更新为"已选择"状态 */
  private async updateSubmittedCard(
    requestId: string,
    qIdx: number,
    frame: TemplateCardEventFrame,
  ): Promise<void> {
    const state = this.store.get(requestId);
    const msgid = state?.questionMsgids?.[qIdx];
    if (!msgid) return;

    try {
      // 构造带 response_code 的 frame 用于更新指定卡片
      const updateFrame = {
        ...frame,
        body: {
          ...frame.body,
          event: {
            ...frame.body.event,
            template_card_event: {
              ...frame.body.event.template_card_event,
              task_id: requestId,
              response_code: msgid,
            },
          },
        },
      };
      await this.updateCard(updateFrame, {
        card_type: 'text_notice',
        source: { desc: 'Lynel', desc_color: 0 },
        main_title: { title: '已选择' },
      });
    } catch {
      // 更新失败不影响主流程
    }
  }

  private async updateOrNotify(
    requestId: string,
    chatId: string,
    decision: 'allow' | 'deny',
    frame: TemplateCardEventFrame,
  ): Promise<void> {
    const state = this.store.get(requestId);
    if (!state) {
      return;
    }

    const text = decision === 'allow' ? '已批准该权限请求。' : '已拒绝该权限请求。';
    try {
      const updateFrame = {
        ...frame,
        body: {
          ...frame.body,
          event: {
            ...frame.body.event,
            template_card_event: {
              ...frame.body.event.template_card_event,
              task_id: requestId,
              response_code: state.msgid,
            },
          },
        },
      };
      await this.updateCard(updateFrame, {
        card_type: 'text_notice',
        source: { desc: 'Lynel', desc_color: 0 },
        main_title: { title: text },
      });
    } catch {
      await this.sendReply(chatId, text, requestId);
    }
  }
}
