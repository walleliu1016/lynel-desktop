/**
 * dsh-lynel-plugin — AskUserQuestion HTTP hook.
 *
 * Registers a `conversation.composer` chain entry with a negative priority so
 * it is tried BEFORE the shipped question UI. Its selector claims every
 * question wait; the panel forwards the questions to the Lynel backend
 * (`POST /lynel/proxy/ask` → `http://localhost:17527/deepseek-harness/ask`),
 * awaits the structured reply, and answers the wait through the carrier.
 *
 * When the backend is unreachable or returns an error, the panel degrades to
 * a minimal inline answer UI so the session never blocks on a dead hook.
 *
 * Ask protocol (request → response):
 *   POST /deepseek-harness/ask
 *   { "requestId", "sessionId", "questions": AskUserQuestionItem[], "ts" }
 *   → 200 { "answers": [{ "id", "selected": string[], "custom"? }] }
 *   → 200 { "cancelled": true }
 */

import { useEffect, useState, type CSSProperties } from 'react';
import type { AskAnswer, AskAnswerItem, AskQuestion, QuestionWait } from './types';

/** Pure chain selector: claim the composer while a question wait is pending. */
export function selectQuestion(owner: { interactions?: ReadonlyArray<{ kind: string }> }): QuestionWait | null {
  const found = owner.interactions?.find((item) => item.kind === 'question');
  return (found as QuestionWait | undefined) ?? null;
}

const ASK_PROXY = '/lynel/proxy/ask';

type Phase = 'asking' | 'error' | 'manual' | 'done';

interface AskHookPanelProps {
  matched: QuestionWait;
}

export function AskHookPanel({ matched }: AskHookPanelProps) {
  const questions = matched.payload.questions;
  const [phase, setPhase] = useState<Phase>('asking');
  const [detail, setDetail] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, { selected: string[]; custom: string }>>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(ASK_PROXY, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            requestId: matched.key,
            sessionId: matched.sessionId,
            questions,
            ts: Date.now(),
          }),
        });
        const payload = (await res.json().catch(() => null)) as
          | { answers?: AskAnswerItem[]; cancelled?: boolean }
          | null;
        if (cancelled) return;
        if (res.ok && payload !== null && payload.cancelled === true) {
          await respondCancelled(matched);
          setPhase('done');
          return;
        }
        if (res.ok && payload !== null && Array.isArray(payload.answers)) {
          await respondAnswered(matched, { answers: payload.answers });
          setPhase('done');
          return;
        }
        setDetail(`后端返回异常（HTTP ${res.status}）`);
        setPhase('error');
      } catch (error) {
        if (cancelled) return;
        setDetail(error instanceof Error ? error.message : String(error));
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [matched, attempt]);

  /* ── manual fallback helpers ── */

  const toggleOption = (questionId: string, label: string, multi: boolean) => {
    setDrafts((current) => {
      const draft = current[questionId] ?? { selected: [], custom: '' };
      const selected = multi
        ? draft.selected.includes(label)
          ? draft.selected.filter((item) => item !== label)
          : [...draft.selected, label]
        : [label];
      return { ...current, [questionId]: { ...draft, selected } };
    });
  };

  const setCustom = (questionId: string, custom: string) => {
    setDrafts((current) => {
      const draft = current[questionId] ?? { selected: [], custom: '' };
      return { ...current, [questionId]: { ...draft, custom } };
    });
  };

  const submitManual = async () => {
    const answers: AskAnswerItem[] = questions.map((question) => {
      const draft = drafts[question.id] ?? { selected: [], custom: '' };
      return { id: question.id, selected: draft.selected, custom: draft.custom || undefined };
    });
    await respondAnswered(matched, { answers });
    setPhase('done');
  };

  /* ── render ── */

  const waitingStyle: CSSProperties = {
    padding: '12px 16px',
    fontSize: 13,
    lineHeight: '20px',
    color: 'var(--dsw-alias-label-secondary, #8a8f98)',
  };

  if (phase === 'done') {
    return (
      <div style={waitingStyle}>
        <strong>已通过 Lynel 回答</strong>
      </div>
    );
  }

  if (phase === 'asking') {
    return (
      <div style={waitingStyle}>
        <strong>等待 Lynel 后端回答…</strong>
        <div style={{ marginTop: 4, opacity: 0.8 }}>
          {questions.map((question) => question.question).join(' / ')}
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div style={{ padding: '12px 16px', fontSize: 13 }}>
        <div style={{ color: 'var(--dsw-alias-state-error-primary, #f85149)' }}>Lynel ask 钩子失败：{detail}</div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              setPhase('asking');
              setAttempt((current) => current + 1);
            }}
          >
            重试
          </button>
          <button type="button" onClick={() => setPhase('manual')}>
            在此手动回答
          </button>
          <button type="button" onClick={async () => { await respondCancelled(matched); setPhase('done'); }}>
            取消
          </button>
        </div>
      </div>
    );
  }

  /* manual fallback */
  return (
    <div style={{ padding: '12px 16px', fontSize: 13, maxWidth: 520 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Lynel 后端不可用 — 手动回答</div>
      {questions.map((question, index) => (
        <QuestionEditor
          key={question.id}
          question={question}
          index={index}
          draft={drafts[question.id] ?? { selected: [], custom: '' }}
          onToggle={toggleOption}
          onCustom={setCustom}
        />
      ))}
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => void submitManual()}>
          提交回答
        </button>
        <button type="button" onClick={async () => { await respondCancelled(matched); setPhase('done'); }}>
          取消
        </button>
      </div>
    </div>
  );
}

function QuestionEditor({
  question,
  index,
  draft,
  onToggle,
  onCustom,
}: {
  question: AskQuestion;
  index: number;
  draft: { selected: string[]; custom: string };
  onToggle: (id: string, label: string, multi: boolean) => void;
  onCustom: (id: string, custom: string) => void;
}) {
  const multi = question.multiSelect === true;
  return (
    <fieldset style={{ margin: '8px 0', border: '1px solid var(--dsw-alias-border-l1, #2b2e36)', borderRadius: 8, padding: '8px 10px' }}>
      <legend>
        {index + 1}. {question.question}
      </legend>
      {question.header && <div style={{ opacity: 0.7 }}>{question.header}</div>}
      {question.detail && <div style={{ whiteSpace: 'pre-wrap', opacity: 0.85 }}>{question.detail}</div>}
      {question.options?.map((option) => (
        <label key={option.label} style={{ display: 'block', margin: '4px 0' }}>
          <input
            type={multi ? 'checkbox' : 'radio'}
            name={question.id}
            checked={draft.selected.includes(option.label)}
            onChange={() => onToggle(question.id, option.label, multi)}
          />{' '}
          {option.label}
          {option.description && <span style={{ opacity: 0.7 }}> — {option.description}</span>}
        </label>
      ))}
      <input
        style={{ marginTop: 6, width: '100%', boxSizing: 'border-box' }}
        placeholder="其他（可选）"
        value={draft.custom}
        onChange={(event) => onCustom(question.id, event.target.value)}
      />
    </fieldset>
  );
}

/* ── wire encodings (mirror `PendingQuestion.answer` / `cancel`) ─────────── */

async function respondAnswered(matched: QuestionWait, answer: AskAnswer): Promise<void> {
  const receipt = await matched.respond({ ok: true, value: { sessionId: matched.sessionId, answer } });
  if (!receipt.accepted) throw new Error(`question response rejected: ${receipt.reason ?? 'unknown'}`);
}

async function respondCancelled(matched: QuestionWait): Promise<void> {
  const receipt = await matched.respond({
    ok: false,
    error: { code: 'cancelled', message: 'the user closed this question request', details: {} },
  });
  if (!receipt.accepted) throw new Error(`question cancellation rejected: ${receipt.reason ?? 'unknown'}`);
}
