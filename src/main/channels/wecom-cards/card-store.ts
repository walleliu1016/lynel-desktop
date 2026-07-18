/**
 * 企业微信模板卡片状态存储。
 * 用于记录 requestId 与已发送卡片的映射，支持重复点击检测与生命周期管理。
 */

export interface CardState {
  requestId: string;
  seq: number;
  chatId: string;
  msgid: string;
  /** 多卡片场景下每道题的 msgid，按问题索引 */
  questionMsgids?: string[];
  sessionId?: string;
  status: 'pending' | 'resolved' | 'cancelled';
  decision?: 'allow' | 'deny';
  answers?: Record<string, string | string[]>;
  /** 多卡片场景下已收集到的部分答案（按问题索引） */
  questionAnswers?: Map<number, string | string[]>;
  sentAt: number;
}

export class WeComCardStore {
  // requestId -> 卡片状态
  private readonly states = new Map<string, CardState>();

  /**
   * 保存新发送的卡片状态，初始为 pending。
   */
  save(requestId: string, seq: number, chatId: string, msgid: string, sessionId?: string): void {
    this.states.set(requestId, {
      requestId,
      seq,
      chatId,
      msgid,
      sessionId,
      status: 'pending',
      sentAt: Date.now(),
    });
  }

  /**
   * 追加多卡片场景下某道题的 msgid（按问题索引）。
   */
  addQuestionMsgid(requestId: string, qIdx: number, msgid: string): void {
    const state = this.states.get(requestId);
    if (!state) return;
    if (!state.questionMsgids) state.questionMsgids = [];
    state.questionMsgids[qIdx] = msgid;
  }

  /**
   * 记录某道题的部分答案。返回 true 表示所有问题均已作答。
   */
  recordAnswer(requestId: string, qIdx: number, totalQuestions: number, answer: string | string[]): boolean {
    const state = this.states.get(requestId);
    if (!state || state.status !== 'pending') return false;
    if (!state.questionAnswers) state.questionAnswers = new Map();
    state.questionAnswers.set(qIdx, answer);
    return state.questionAnswers.size >= totalQuestions;
  }

  /**
   * 获取累积的全部答案，将问题文本映射到答案值。
   */
  getAccumulatedAnswers(requestId: string, questions: Array<{ question: string }>): Record<string, string | string[]> {
    const state = this.states.get(requestId);
    const result: Record<string, string | string[]> = {};
    if (!state?.questionAnswers) return result;
    for (const [qIdx, answer] of state.questionAnswers) {
      if (qIdx < questions.length) {
        result[questions[qIdx].question] = answer;
      }
    }
    return result;
  }

  /**
   * 获取指定 requestId 的卡片状态。
   */
  get(requestId: string): CardState | undefined {
    return this.states.get(requestId);
  }

  /**
   * 将卡片标记为已解决，并记录用户决策与回答。
   */
  resolve(requestId: string, decision: 'allow' | 'deny', answers?: Record<string, string | string[]>): void {
    const state = this.states.get(requestId);
    if (!state || state.status !== 'pending') return;

    state.status = 'resolved';
    state.decision = decision;
    if (answers !== undefined) {
      state.answers = answers;
    }
  }

  /**
   * 将卡片标记为已取消。
   */
  cancel(requestId: string): void {
    const state = this.states.get(requestId);
    if (!state || state.status !== 'pending') return;

    state.status = 'cancelled';
  }

  /**
   * 取消指定会话下所有 pending 的卡片。
   */
  cancelBySession(sessionId: string): void {
    for (const state of this.states.values()) {
      if (state.sessionId === sessionId && state.status === 'pending') {
        state.status = 'cancelled';
      }
    }
  }
}
