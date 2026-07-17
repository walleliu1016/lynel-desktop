# 企业微信模板卡片改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Lynel Desktop 企业微信通道的 `PermissionRequest` 和 `AskUserQuestion` 从 Markdown + slash 命令改造为模板卡片交互，用户点击卡片按钮即可完成允许/拒绝/选择答案，同时保留 slash 命令作为兜底。

**Architecture:** 新增 `src/main/channels/wecom-cards/` 目录，包含卡片构建、事件处理、状态存储三个独立模块；`WeComChannel` 负责事件分发和卡片发送，失败时降级到现有 Markdown 文本；用户点击卡片后通过 `template_card_event` 回到 `event-handler`，最终调用 `permissionBroker.resolve`。

**Tech Stack:** TypeScript, Vitest, `@wecom/aibot-node-sdk`, `@wecom/wecom-openclaw-plugin`

---

## 文件结构

新建文件：

- `src/main/channels/wecom-cards/card-builder.ts` — 构建 `TemplateCard`
- `src/main/channels/wecom-cards/card-store.ts` — 保存 `requestId → msgid` 映射
- `src/main/channels/wecom-cards/event-handler.ts` — 解析 `template_card_event`
- `tests/main/channels/wecom-cards/card-builder.test.ts`
- `tests/main/channels/wecom-cards/card-store.test.ts`
- `tests/main/channels/wecom-cards/event-handler.test.ts`
- `tests/main/channels/wecom-channel-cards.test.ts` — WeComChannel 集成测试

修改文件：

- `src/main/channels/wecom-channel.ts` — 接入卡片发送和事件监听
- `src/main/types/wecom-plugin.d.ts` — 补充 `template_card` 相关类型声明

---

## 前置准备

### Task 0: 创建功能分支

**Files:** 无新增/修改

- [ ] **Step 1: 基于 main 创建分支**

```bash
git checkout -b feat/wecom-template-cards
```

- [ ] **Step 2: 提交设计文档**

```bash
git add docs/superpowers/specs/2026-07-17-wecom-template-card-design.md
git commit -m "docs: 企业微信模板卡片改造设计文档"
```

---

## Task 1: Card Store（状态存储）

**Files:**
- Create: `src/main/channels/wecom-cards/card-store.ts`
- Test: `tests/main/channels/wecom-cards/card-store.test.ts`

**Goal:** 保存 `requestId → { msgid, chatId, seq, status }`，支持 updateTemplateCard 和重复点击检测。

- [ ] **Step 1: 编写失败测试**

Create `tests/main/channels/wecom-cards/card-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WeComCardStore } from '../../../../src/main/channels/wecom-cards/card-store.js';

describe('WeComCardStore', () => {
  let store: WeComCardStore;

  beforeEach(() => {
    store = new WeComCardStore();
  });

  it('saves and retrieves card state', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1');
    const state = store.get('req-1');
    expect(state).toEqual({
      requestId: 'req-1',
      seq: 1,
      chatId: 'chat-1',
      msgid: 'msgid-1',
      status: 'pending',
      sentAt: expect.any(Number),
    });
  });

  it('returns undefined for unknown request', () => {
    expect(store.get('unknown')).toBeUndefined();
  });

  it('marks resolved with decision and answers', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1');
    store.resolve('req-1', 'allow', { q1: 'A' });
    const state = store.get('req-1');
    expect(state?.status).toBe('resolved');
    expect(state?.decision).toBe('allow');
    expect(state?.answers).toEqual({ q1: 'A' });
  });

  it('cancels by request id', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1');
    store.cancel('req-1');
    expect(store.get('req-1')?.status).toBe('cancelled');
  });

  it('cancels by session id', () => {
    store.save('req-1', 1, 'chat-1', 'msgid-1', 'sid-1');
    store.save('req-2', 2, 'chat-1', 'msgid-2', 'sid-1');
    store.cancelBySession('sid-1');
    expect(store.get('req-1')?.status).toBe('cancelled');
    expect(store.get('req-2')?.status).toBe('cancelled');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/main/channels/wecom-cards/card-store.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 CardStore**

Create `src/main/channels/wecom-cards/card-store.ts`:

```ts
export interface CardState {
  requestId: string;
  seq: number;
  chatId: string;
  msgid: string;
  sessionId?: string;
  status: 'pending' | 'resolved' | 'cancelled';
  decision?: 'allow' | 'deny';
  answers?: Record<string, string | string[]>;
  sentAt: number;
}

export class WeComCardStore {
  private store = new Map<string, CardState>();

  save(requestId: string, seq: number, chatId: string, msgid: string, sessionId?: string): void {
    this.store.set(requestId, {
      requestId,
      seq,
      chatId,
      msgid,
      sessionId,
      status: 'pending',
      sentAt: Date.now(),
    });
  }

  get(requestId: string): CardState | undefined {
    return this.store.get(requestId);
  }

  resolve(
    requestId: string,
    decision: 'allow' | 'deny',
    answers?: Record<string, string | string[]>,
  ): void {
    const state = this.store.get(requestId);
    if (!state) return;
    state.status = 'resolved';
    state.decision = decision;
    if (answers) state.answers = answers;
  }

  cancel(requestId: string): void {
    const state = this.store.get(requestId);
    if (!state) return;
    state.status = 'cancelled';
  }

  cancelBySession(sessionId: string): void {
    for (const state of this.store.values()) {
      if (state.sessionId === sessionId && state.status === 'pending') {
        state.status = 'cancelled';
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/main/channels/wecom-cards/card-store.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/channels/wecom-cards/card-store.ts tests/main/channels/wecom-cards/card-store.test.ts
git commit -m "feat: 企业微信卡片状态存储 WeComCardStore"
```

---

## Task 2: Card Builder（卡片构建）

**Files:**
- Create: `src/main/channels/wecom-cards/card-builder.ts`
- Test: `tests/main/channels/wecom-cards/card-builder.test.ts`

**Goal:** 根据 `PermissionRequest` 和 `AskUserQuestion` 输入构建企业微信 `TemplateCard`。

- [ ] **Step 1: 编写失败测试**

Create `tests/main/channels/wecom-cards/card-builder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildPermissionCard,
  buildAskQuestionCard,
} from '../../../../src/main/channels/wecom-cards/card-builder.js';
import type { PermissionRequest } from '../../../../src/main/permission-broker.js';

describe('buildPermissionCard', () => {
  it('builds button_interaction card with allow/deny keys', () => {
    const req: PermissionRequest = {
      id: 'req-1',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'BashCommand',
      toolInput: { command: 'ls' },
    };
    const card = buildPermissionCard(req, 3);
    expect(card.card_type).toBe('button_interaction');
    expect(card.main_title?.title).toContain('权限请求');
    expect(card.button_list).toHaveLength(2);
    expect(card.button_list![0].key).toBe('wecom:allow:req-1');
    expect(card.button_list![1].key).toBe('wecom:deny:req-1');
  });
});

describe('buildAskQuestionCard', () => {
  it('builds vote_interaction for single-select single question', () => {
    const card = buildAskQuestionCard(3, {
      questions: [
        {
          header: '框架选择',
          question: '用哪个测试框架？',
          multiSelect: false,
          options: [{ label: 'Vitest' }, { label: 'Jest' }],
        },
      ],
    });
    expect(card.card_type).toBe('vote_interaction');
    expect(card.main_title?.title).toBe('框架选择');
    expect(card.checkbox?.option_list).toHaveLength(2);
  });

  it('builds multiple_interaction for multi-select', () => {
    const card = buildAskQuestionCard(3, {
      questions: [
        {
          question: '安装哪些依赖？',
          multiSelect: true,
          options: [{ label: 'eslint' }, { label: 'prettier' }],
        },
      ],
    });
    expect(card.card_type).toBe('multiple_interaction');
    expect(card.select_list?.[0].option_list).toHaveLength(2);
    expect(card.submit_button?.key).toBe('wecom:submit:req-3');
  });

  it('builds multiple_interaction for multiple questions', () => {
    const card = buildAskQuestionCard(3, {
      questions: [
        { question: 'Q1', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
        { question: 'Q2', multiSelect: true, options: [{ label: 'C' }, { label: 'D' }] },
      ],
    });
    expect(card.card_type).toBe('multiple_interaction');
    expect(card.select_list).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/main/channels/wecom-cards/card-builder.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 CardBuilder**

Create `src/main/channels/wecom-cards/card-builder.ts`:

```ts
import type { PermissionRequest } from '../../permission-broker.js';

export const EVENT_KEY_PREFIX = 'wecom';

function encodeKey(action: string, requestId: string, ...extra: (string | number)[]): string {
  const parts = [EVENT_KEY_PREFIX, action, requestId, ...extra.map(String)];
  return parts.join(':');
}

function formatToolInput(toolInput: unknown): string {
  const input = toolInput as Record<string, any> | undefined;
  if (!input || typeof input !== 'object') return '';
  if (input.command) return String(input.command);
  if (input.file_path || input.path) return String(input.file_path || input.path);
  return JSON.stringify(input).slice(0, 200);
}

export function buildPermissionCard(req: PermissionRequest, seq: number): any {
  const preview = formatToolInput(req.toolInput);
  return {
    card_type: 'button_interaction',
    source: {
      desc: 'Lynel',
      desc_color: 0,
    },
    main_title: {
      title: '🔒 权限请求',
      desc: `${req.toolName}（会话#${seq}）`,
    },
    sub_title_text: preview ? `命令/路径：${preview}` : undefined,
    button_list: [
      { text: '允许', style: 1, key: encodeKey('allow', req.id) },
      { text: '拒绝', style: 4, key: encodeKey('deny', req.id) },
    ],
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

export function buildAskQuestionCard(seq: number, input: AskInput, requestId?: string): any {
  const questions = input.questions ?? [];
  const singleQuestion = questions.length === 1 ? questions[0] : undefined;
  const title = singleQuestion?.header ?? `Claude 提问（${questions.length}个问题）`;

  if (singleQuestion && !singleQuestion.multiSelect) {
    return {
      card_type: 'vote_interaction',
      source: { desc: 'Lynel', desc_color: 0 },
      main_title: { title: `❓ ${title}`, desc: singleQuestion.question },
      checkbox: {
        question_key: encodeKey('answer', requestId ?? `seq-${seq}`),
        mode: 0,
        option_list: singleQuestion.options.map((o, idx) => ({
          id: encodeKey('opt', requestId ?? `seq-${seq}`, 0, idx),
          text: o.label,
        })),
      },
      submit_button: {
        text: '提交',
        key: encodeKey('submit', requestId ?? `seq-${seq}`),
      },
    };
  }

  return {
    card_type: 'multiple_interaction',
    source: { desc: 'Lynel', desc_color: 0 },
    main_title: { title: `❓ ${title}` },
    select_list: questions.map((q, qIdx) => ({
      question_key: encodeKey('answer', requestId ?? `seq-${seq}`, qIdx),
      title: q.header ?? q.question,
      option_list: q.options.map((o, oIdx) => ({
        id: encodeKey('opt', requestId ?? `seq-${seq}`, qIdx, oIdx),
        text: o.label,
      })),
    })),
    submit_button: {
      text: '提交',
      key: encodeKey('submit', requestId ?? `seq-${seq}`),
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/main/channels/wecom-cards/card-builder.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/channels/wecom-cards/card-builder.ts tests/main/channels/wecom-cards/card-builder.test.ts
git commit -m "feat: 企业微信模板卡片构建器"
```

---

## Task 3: Event Handler（事件处理）

**Files:**
- Create: `src/main/channels/wecom-cards/event-handler.ts`
- Test: `tests/main/channels/wecom-cards/event-handler.test.ts`

**Goal:** 解析 `template_card_event`，调用 `permissionBroker.resolve`，并回复提示 / 更新卡片。

- [ ] **Step 1: 编写失败测试**

Create `tests/main/channels/wecom-cards/event-handler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeComCardEventHandler } from '../../../../src/main/channels/wecom-cards/event-handler.js';
import { WeComCardStore } from '../../../../src/main/channels/wecom-cards/card-store.js';
import { permissionBroker } from '../../../../src/main/permission-broker.js';

describe('WeComCardEventHandler', () => {
  let store: WeComCardStore;
  let handler: WeComCardEventHandler;
  let replyFn: ReturnType<typeof vi.fn>;
  let updateCardFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new WeComCardStore();
    replyFn = vi.fn().mockResolvedValue(undefined);
    updateCardFn = vi.fn().mockResolvedValue(undefined);
    handler = new WeComCardEventHandler(store, replyFn, updateCardFn);
  });

  afterEach(() => {
    // 清理 broker 中 pending 请求，避免测试间污染
    permissionBroker.listPending().forEach((p) => permissionBroker.cancel(p.id));
  });

  it('resolves allow decision', async () => {
    const p = permissionBroker.wait({
      id: 'req-1',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'BashCommand',
      toolInput: {},
    });
    store.save('req-1', 1, 'chat-1', 'msgid-1', 'sid-1');

    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'wecom:allow:req-1' },
        chatid: 'chat-1',
      },
    } as any);

    await expect(p).resolves.toEqual({ decision: 'allow', answers: undefined });
    expect(updateCardFn).toHaveBeenCalled();
  });

  it('replies hint when request already resolved', async () => {
    permissionBroker.wait({
      id: 'req-1',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'BashCommand',
      toolInput: {},
    });
    store.save('req-1', 1, 'chat-1', 'msgid-1', 'sid-1');
    permissionBroker.resolve('req-1', 'allow', 'wecom');

    await handler.handle({
      body: {
        event: { eventtype: 'template_card_event', event_key: 'wecom:allow:req-1' },
        chatid: 'chat-1',
      },
    } as any);

    expect(replyFn).toHaveBeenCalledWith('chat-1', expect.stringContaining('已被处理'));
  });

  it('resolves AskUserQuestion with selected options', async () => {
    const p = permissionBroker.wait({
      id: 'req-2',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [{ question: 'Q1', options: [{ label: 'A' }, { label: 'B' }] }],
      },
    });
    store.save('req-2', 2, 'chat-1', 'msgid-2', 'sid-1');

    await handler.handle({
      body: {
        event: {
          eventtype: 'template_card_event',
          event_key: 'wecom:submit:req-2',
          selected_items: [
            { question_key: 'wecom:answer:req-2:0', option_ids: ['wecom:opt:req-2:0:1'] },
          ],
        },
        chatid: 'chat-1',
      },
    } as any);

    await expect(p).resolves.toEqual({
      decision: 'allow',
      answers: { Q1: 'B' },
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/main/channels/wecom-cards/event-handler.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 EventHandler**

Create `src/main/channels/wecom-cards/event-handler.ts`:

```ts
import { permissionBroker } from '../../permission-broker.js';
import type { WeComCardStore } from './card-store.js';

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

export class WeComCardEventHandler {
  constructor(
    private store: WeComCardStore,
    private sendReply: (chatId: string, text: string) => Promise<void>,
    private updateCard: (msgid: string, card: any) => Promise<void>,
  ) {}

  async handle(frame: TemplateCardEventFrame): Promise<void> {
    const chatId = frame.body.chatid || frame.body.from?.userid;
    if (!chatId) return;

    const eventKey = frame.body.event.event_key;
    const parsed = this.parseEventKey(eventKey);
    if (!parsed) {
      await this.sendReply(chatId, '无法识别的卡片操作。');
      return;
    }

    const { action, requestId } = parsed;
    const state = this.store.get(requestId);

    if (!state || state.status !== 'pending') {
      await this.sendReply(chatId, '该请求已被处理或已过期，请勿重复操作。');
      return;
    }

    if (action === 'allow' || action === 'deny') {
      const ok = permissionBroker.resolve(requestId, action, 'wecom');
      if (ok) {
        this.store.resolve(requestId, action);
        await this.updateOrNotify(requestId, chatId, action);
      }
      return;
    }

    if (action === 'submit' || action === 'answer') {
      const answers = this.buildAnswers(requestId, frame.body.event.selected_items);
      if ('error' in answers) {
        await this.sendReply(chatId, `回答格式错误：${answers.error}`);
        return;
      }
      const ok = permissionBroker.resolve(requestId, 'allow', 'wecom', answers);
      if (ok) {
        this.store.resolve(requestId, 'allow', answers);
        await this.updateOrNotify(requestId, chatId, 'allow');
      }
      return;
    }

    await this.sendReply(chatId, '不支持的卡片操作。');
  }

  private parseEventKey(key: string): { action: string; requestId: string } | undefined {
    const parts = key.split(':');
    if (parts.length < 3 || parts[0] !== 'wecom') return undefined;
    return { action: parts[1], requestId: parts[2] };
  }

  private buildAnswers(
    requestId: string,
    selectedItems: TemplateCardEventFrame['body']['event']['selected_items'],
  ): Record<string, string | string[]> | { error: string } {
    if (!selectedItems || selectedItems.length === 0) {
      return { error: '未选择任何选项' };
    }

    const state = this.store.get(requestId);
    const req = state ? permissionBroker.listPending().find((p) => p.id === requestId)?.request : undefined;
    const toolInput = (req?.toolInput as any) ?? {};
    const questions = toolInput.questions ?? [];
    const answers: Record<string, string | string[]> = {};

    for (const item of selectedItems) {
      const qParts = item.question_key.split(':');
      const qIdx = parseInt(qParts[3] ?? '0', 10);
      const question = questions[qIdx];
      if (!question) continue;

      const labels: string[] = [];
      for (const optId of item.option_ids ?? []) {
        const oParts = optId.split(':');
        const oIdx = parseInt(oParts[4] ?? '0', 10);
        const option = question.options[oIdx];
        if (option) labels.push(option.label);
      }

      answers[question.question] = question.multiSelect ? labels : labels[0] ?? '';
    }

    return answers;
  }

  private async updateOrNotify(
    requestId: string,
    chatId: string,
    decision: 'allow' | 'deny',
  ): Promise<void> {
    const state = this.store.get(requestId);
    if (!state) return;

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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/main/channels/wecom-cards/event-handler.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/channels/wecom-cards/event-handler.ts tests/main/channels/wecom-cards/event-handler.test.ts
git commit -m "feat: 企业微信模板卡片事件处理器"
```

---

## Task 4: 类型声明补充

**Files:**
- Modify: `src/main/types/wecom-plugin.d.ts`

**Goal:** 让 TypeScript 识别 `template_card` 消息体和 `WSClient.updateTemplateCard` 类型。

- [ ] **Step 1: 修改类型声明**

Edit `src/main/types/wecom-plugin.d.ts`:

```ts
declare module '@wecom/wecom-openclaw-plugin' {
  const mod: any;
  export default mod;
}

declare module '@wecom/aibot-node-sdk' {
  const mod: any;
  export = mod;
}

// 补充 template_card 相关类型，避免 any 泛滥
declare module '@wecom/aibot-node-sdk/dist/types/api' {
  export interface SendTemplateCardMsgBody {
    msgtype: 'template_card';
    template_card: any;
  }
}
```

- [ ] **Step 2: 运行类型检查确认无新增错误**

```bash
npx tsc --noEmit
```

Expected: 无新增 TypeScript 错误（项目本身可能有既有错误，需与改动前对比）

- [ ] **Step 3: 提交**

```bash
git add src/main/types/wecom-plugin.d.ts
git commit -m "chore: 补充企业微信 template_card 类型声明"
```

---

## Task 5: WeComChannel 接入卡片发送

**Files:**
- Modify: `src/main/channels/wecom-channel.ts`
- Test: `tests/main/channels/wecom-channel-cards.test.ts`

**Goal:** `WeComChannel.send(PermissionRequest)` 发送模板卡片，失败时降级 Markdown。

- [ ] **Step 1: 编写失败测试**

Create `tests/main/channels/wecom-channel-cards.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeComChannel } from '../../src/main/channels/wecom-channel.js';
import { permissionBroker } from '../../src/main/permission-broker.js';

describe('WeComChannel template cards', () => {
  let channel: WeComChannel;
  let sendTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendTextMock = vi.fn().mockResolvedValue({ body: { msgid: 'msgid-123' } });
    channel = new WeComChannel({
      enabled: true,
      chatId: 'chat-1',
      botId: 'bot-1',
      secret: 'secret-1',
    });
    // 直接注入 mock wsClient
    (channel as any).ensureWebSocket = vi.fn().mockResolvedValue(undefined);
    (channel as any).wsClient = {
      isConnected: true,
      sendMessage: sendTextMock,
    };
  });

  afterEach(() => {
    permissionBroker.listPending().forEach((p) => permissionBroker.cancel(p.id));
  });

  it('sends template_card for PermissionRequest', async () => {
    channel.send({
      seq: 1,
      turn: 1,
      sessionId: 'sid-1',
      workDir: '/wd',
      kind: 'PermissionRequest',
      payload: {
        id: 'req-1',
        sessionId: 'sid-1',
        workDir: '/wd',
        toolName: 'BashCommand',
        toolInput: { command: 'ls' },
        seq: 1,
      },
      timestamp: Date.now(),
    });

    // send 是异步的，等待一下
    await new Promise((r) => setTimeout(r, 50));

    const calls = sendTextMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [, body] = calls[0];
    expect(body.msgtype).toBe('template_card');
    expect(body.template_card.card_type).toBe('button_interaction');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/main/channels/wecom-channel-cards.test.ts
```

Expected: FAIL（send 尚未使用 template_card）

- [ ] **Step 3: 修改 WeComChannel 发送逻辑**

在 `src/main/channels/wecom-channel.ts` 中：

1. 文件顶部导入新增模块：

```ts
import { buildPermissionCard, buildAskQuestionCard } from './wecom-cards/card-builder.js';
import { WeComCardStore } from './wecom-cards/card-store.js';
```

2. 在 `WeComChannel` 类中新增私有成员：

```ts
private cardStore = new WeComCardStore();
```

3. 修改 `send` 方法中 `PermissionRequest` 分支，添加卡片发送：

```ts
case 'PermissionRequest': {
  const toolName = p?.toolName || 'unknown';
  const reqId = this.getSessionCmdArg(event.sessionId);
  if (toolName === 'AskUserQuestion') {
    return this.sendAskQuestionCard(event, msgSeq);
  }
  return this.sendPermissionCard(event, msgSeq);
}
```

4. 新增私有方法：

```ts
private async sendPermissionCard(event: ProxyStageEvent, msgSeq: number): Promise<void> {
  const p = event.payload as any;
  const req: PermissionRequest = {
    id: p.id,
    sessionId: event.sessionId,
    workDir: event.workDir,
    toolName: p.toolName || 'unknown',
    toolInput: p.toolInput,
  };
  const seq = p.seq ?? msgSeq;
  const card = buildPermissionCard(req, seq);
  const ok = await this.sendTemplateCard(card, event.sessionId, req.id, seq);
  if (!ok) {
    const content = this.formatPermissionRequest(
      this.formatHeader(event, msgSeq),
      p.toolName || 'unknown',
      p.toolInput,
      this.getSessionCmdArg(event.sessionId),
    );
    await this.sendContent(content, event.sessionId);
  }
}

private async sendAskQuestionCard(event: ProxyStageEvent, msgSeq: number): Promise<void> {
  const p = event.payload as any;
  const seq = p.seq ?? msgSeq;
  const input = p.toolInput as any;
  const reqId = p.id;
  const card = buildAskQuestionCard(seq, input, reqId);
  const ok = await this.sendTemplateCard(card, event.sessionId, reqId, seq);
  if (!ok) {
    const content = this.formatAskUserQuestion(
      this.formatHeader(event, msgSeq),
      input,
      this.getSessionCmdArg(event.sessionId),
    );
    await this.sendContent(content, event.sessionId);
  }
}

private async sendTemplateCard(
  card: any,
  sessionId: string,
  requestId: string,
  seq: number,
): Promise<boolean> {
  try {
    await this.ensureWebSocket();
    if (!this.wsClient?.isConnected || !this.cfg.chatId) return false;

    const result = await this.wsClient.sendMessage(this.cfg.chatId, {
      msgtype: 'template_card',
      template_card: card,
    });

    const msgid = result?.body?.msgid ?? result?.headers?.req_id;
    if (msgid) {
      this.cardStore.save(requestId, seq, this.cfg.chatId, msgid, sessionId);
    }
    return true;
  } catch (err) {
    logger.error('[wecom-channel] sendTemplateCard failed:', err);
    return false;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/main/channels/wecom-channel-cards.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/channels/wecom-channel.ts tests/main/channels/wecom-channel-cards.test.ts
git commit -m "feat: WeComChannel 发送权限/提问模板卡片"
```

---

## Task 6: WeComChannel 接入卡片点击事件

**Files:**
- Modify: `src/main/channels/wecom-channel.ts`

**Goal:** 在 WebSocket 连接成功后监听 `event.template_card_event`。

- [ ] **Step 1: 导入 EventHandler**

在 `src/main/channels/wecom-channel.ts` 顶部：

```ts
import { WeComCardEventHandler } from './wecom-cards/event-handler.js';
```

- [ ] **Step 2: 在 WeComChannel 中创建 handler 并注册事件**

在 `connect()` 方法中，`wsClient.on('message', ...)` 附近添加：

```ts
wsClient.on('event.template_card_event', (frame: any) => {
  try {
    this.handleCardEvent(frame);
  } catch (err) {
    logger.error('[wecom-channel] failed to handle card event:', err);
  }
});
```

新增私有方法：

```ts
private cardEventHandler?: WeComCardEventHandler;

private getCardEventHandler(): WeComCardEventHandler {
  if (!this.cardEventHandler) {
    this.cardEventHandler = new WeComCardEventHandler(
      this.cardStore,
      (chatId, text) => this.sendWeComReply(chatId, text),
      async (frame, card) => {
        if (!this.wsClient) throw new Error('WSClient not connected');
        await this.wsClient.updateTemplateCard(frame, card);
      },
    );
  }
  return this.cardEventHandler;
}

private handleCardEvent(frame: any): void {
  this.getCardEventHandler().handle(frame).catch((err) => {
    logger.error('[wecom-channel] card event handler error:', err);
  });
}
```

- [ ] **Step 3: 运行主进程测试**

```bash
npm run test:main
```

Expected: PASS（或仅出现与改动前一致的既有失败）

- [ ] **Step 4: 提交**

```bash
git add src/main/channels/wecom-channel.ts
git commit -m "feat: WeComChannel 监听模板卡片点击事件"
```

---

## Task 7: updateTemplateCard 集成

**Files:**
- Modify: `src/main/channels/wecom-channel.ts`
- Modify: `src/main/channels/wecom-cards/event-handler.ts`

**Goal:** 拿到底层 `wsClient.updateTemplateCard` 能力，在点击处理后更新原卡片。

- [ ] **Step 1: 修改 event-handler 接收 wsClient 更新函数**

将 `event-handler.ts` 构造函数中的 `updateCard` 参数改为接收 `(frame: any, card: any) => Promise<void>`，以便使用事件帧中的 `req_id`。

```ts
export class WeComCardEventHandler {
  constructor(
    private store: WeComCardStore,
    private sendReply: (chatId: string, text: string) => Promise<void>,
    private updateCard: (frame: any, card: any) => Promise<void>,
  ) {}

  // ...
  private async updateOrNotify(
    requestId: string,
    chatId: string,
    decision: 'allow' | 'deny',
    frame: any,
  ): Promise<void> {
    const state = this.store.get(requestId);
    if (!state) return;

    const text = decision === 'allow' ? '已批准该权限请求。' : '已拒绝该权限请求。';
    try {
      await this.updateCard(frame, {
        card_type: 'text_notice',
        source: { desc: 'Lynel', desc_color: 0 },
        main_title: { title: text },
      });
    } catch {
      await this.sendReply(chatId, text);
    }
  }
}
```

同时更新 `handle` 方法调用 `updateOrNotify` 时传入 `frame`。

（Task 6 中 `getCardEventHandler` 已经按此签名注入，无需重复修改。）

- [ ] **Step 2: 运行测试**

```bash
npm run test:main
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/main/channels/wecom-channel.ts src/main/channels/wecom-cards/event-handler.ts
git commit -m "feat: 模板卡片处理后 updateTemplateCard 更新原卡片"
```

---

## Task 8: SessionEnd 清理卡片状态

**Files:**
- Modify: `src/main/channels/wecom-channel.ts`

**Goal:** 会话结束时清理对应 `CardState`。

- [ ] **Step 1: 在 WeComChannel.send 中处理 SessionEnd**

在 `send` 方法里已有的 `SessionEnd` 分支：

```ts
case 'SessionEnd':
  this.cardStore.cancelBySession(event.sessionId);
  return `${header}\n📌 **会话结束**`;
```

- [ ] **Step 2: 运行测试并提交**

```bash
npm run test:main
git add src/main/channels/wecom-channel.ts
git commit -m "feat: SessionEnd 时清理企业微信卡片状态"
```

---

## Task 9: 全量验证

**Files:** 无新增

- [ ] **Step 1: 运行主进程测试**

```bash
npm run test:main
```

Expected: 全绿

- [ ] **Step 2: 运行前端类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
```

Expected: 无新增错误

- [ ] **Step 3: 提交最终检查点**

```bash
git status
```

确认只包含本 feature 相关改动。

---

## 手动测试清单

在真实企业微信环境中验证：

- [ ] 发起 `BashCommand` 权限请求，收到卡片，点击「允许」后 Claude 继续执行。
- [ ] 发起 `AskUserQuestion` 单选，收到卡片，选择后提交，Claude 拿到答案。
- [ ] 发起 `AskUserQuestion` 多选，收到卡片，多选后提交。
- [ ] 发起多个问题的 `AskUserQuestion`。
- [ ] 点击已处理卡片，收到「已被处理」提示。
- [ ] 模拟卡片发送失败（如断网），降级为 Markdown + slash 命令，命令仍可用。

---

## 自我检查

- **Spec coverage:** 所有设计决策都对应到具体 Task（卡片构建 Task 2、事件处理 Task 3、状态存储 Task 1、updateTemplateCard Task 7、降级 Task 5、清理 Task 8）。
- **Placeholder scan:** 无 TBD/TODO。Task 7 中 `updateTemplateCard` 的具体调用基于 SDK 暴露的 `wsClient.updateTemplateCard`。
- **Type consistency:** `CardState`、`PermissionRequest`、`ProxyStageEvent` 的字段名在全文档一致。
