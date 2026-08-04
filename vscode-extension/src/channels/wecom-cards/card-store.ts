export interface CardState {
  requestId: string;
  seq: number;
  chatId: string;
  msgid: string;
  questionMsgids?: string[];
  sessionId?: string;
  status: 'pending' | 'resolved' | 'cancelled';
  decision?: 'allow' | 'deny';
  answers?: Record<string, string | string[]>;
  questionAnswers?: Map<number, string | string[]>;
  sentAt: number;
}

export class WeComCardStore {
  private readonly states = new Map<string, CardState>();

  save(requestId: string, seq: number, chatId: string, msgid: string, sessionId?: string): void {
    this.states.set(requestId, {
      requestId, seq, chatId, msgid, sessionId,
      status: 'pending', sentAt: Date.now(),
    });
  }

  addQuestionMsgid(requestId: string, qIdx: number, msgid: string): void {
    const state = this.states.get(requestId);
    if (!state) return;
    if (!state.questionMsgids) state.questionMsgids = [];
    state.questionMsgids[qIdx] = msgid;
  }

  recordAnswer(requestId: string, qIdx: number, totalQuestions: number, answer: string | string[]): boolean {
    const state = this.states.get(requestId);
    if (!state || state.status !== 'pending') return false;
    if (!state.questionAnswers) state.questionAnswers = new Map();
    state.questionAnswers.set(qIdx, answer);
    return state.questionAnswers.size >= totalQuestions;
  }

  getAccumulatedAnswers(requestId: string, questions: Array<{ question: string }>): Record<string, string | string[]> {
    const state = this.states.get(requestId);
    const result: Record<string, string | string[]> = {};
    if (!state?.questionAnswers) return result;
    for (const [qIdx, answer] of state.questionAnswers) {
      if (qIdx < questions.length) result[questions[qIdx].question] = answer;
    }
    return result;
  }

  get(requestId: string): CardState | undefined {
    return this.states.get(requestId);
  }

  resolve(requestId: string, decision: 'allow' | 'deny', answers?: Record<string, string | string[]>): void {
    const state = this.states.get(requestId);
    if (!state || state.status !== 'pending') return;
    state.status = 'resolved';
    state.decision = decision;
    if (answers !== undefined) state.answers = answers;
  }

  cancel(requestId: string): void {
    const state = this.states.get(requestId);
    if (!state || state.status !== 'pending') return;
    state.status = 'cancelled';
  }

  cancelBySession(sessionId: string): void {
    for (const state of this.states.values()) {
      if (state.sessionId === sessionId && state.status === 'pending') {
        state.status = 'cancelled';
      }
    }
  }
}
