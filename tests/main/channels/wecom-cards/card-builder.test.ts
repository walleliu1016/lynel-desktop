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
    expect(card.main_title?.title).toBe('❓ 框架选择');
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
    expect(card.submit_button?.key).toBe('wecom:submit:seq-3');
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
