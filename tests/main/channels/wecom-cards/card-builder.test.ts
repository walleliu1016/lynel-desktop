import { describe, it, expect } from 'vitest';
import {
  buildPermissionCard,
  buildAskQuestionCard,
} from '../../../../src/main/channels/wecom-cards/card-builder.js';
import type { PermissionRequest } from '../../../../src/main/permission-broker.js';

function makePermissionRequest(toolInput?: unknown): PermissionRequest {
  return {
    id: 'req-1',
    sessionId: 'sid-1',
    workDir: '/wd',
    toolName: 'BashCommand',
    toolInput,
  };
}

describe('buildPermissionCard', () => {
  it('构建 button_interaction 卡片，包含来源、标题、描述与允许/拒绝按钮', () => {
    const req = makePermissionRequest({ command: 'ls' });
    const card = buildPermissionCard(req, 3);

    expect(card).toMatchObject({
      card_type: 'button_interaction',
      source: { desc: 'Lynel', desc_color: 0 },
      main_title: {
        title: '权限请求',
        desc: 'BashCommand（会话#3）',
      },
      sub_title_text: '命令/路径：ls',
      task_id: 'req-1',
      button_list: [
        { text: '允许', style: 1, key: 'wecom:allow:req-1' },
        { text: '拒绝', style: 4, key: 'wecom:deny:req-1' },
      ],
    });
  });

  it('toolInput 包含 file_path 时使用路径作为预览', () => {
    const req = makePermissionRequest({ file_path: '/etc/hosts' });
    const card = buildPermissionCard(req, 1);
    expect(card.sub_title_text).toBe('命令/路径：/etc/hosts');
  });

  it('toolInput 包含 path 时使用路径作为预览', () => {
    const req = makePermissionRequest({ path: '/tmp' });
    const card = buildPermissionCard(req, 1);
    expect(card.sub_title_text).toBe('命令/路径：/tmp');
  });

  it('command 为空字符串时回退为 JSON 预览', () => {
    const req = makePermissionRequest({ command: '', args: ['-la'] });
    const card = buildPermissionCard(req, 1);
    expect(card.sub_title_text).toBe('命令/路径：{"command":"","args":["-la"]}');
  });

  it('toolInput 为普通对象且无命令/路径时回退为 JSON 预览', () => {
    const req = makePermissionRequest({ args: ['-la'] });
    const card = buildPermissionCard(req, 1);
    expect(card.sub_title_text).toBe('命令/路径：{"args":["-la"]}');
  });

  it('toolInput 为非对象原始值时使用 JSON.stringify 作为预览', () => {
    const req = makePermissionRequest('ls');
    const card = buildPermissionCard(req, 1);
    expect(card.sub_title_text).toBe('命令/路径："ls"');
  });

  it('toolInput 为 undefined 或 null 时不展示副标题', () => {
    expect(buildPermissionCard(makePermissionRequest(undefined), 1).sub_title_text).toBeUndefined();
    expect(buildPermissionCard(makePermissionRequest(null), 1).sub_title_text).toBeUndefined();
  });

  it('传入 sessionTitle 时 source.desc 使用项目前缀', () => {
    const req = makePermissionRequest({ command: 'ls' });
    const card = buildPermissionCard(req, 3, '项目优化讨论');
    expect(card).toMatchObject({
      source: { desc: '项目：项目优化讨论', desc_color: 0 },
    });
  });

  it('未传 sessionTitle 时 source.desc 默认为 Lynel', () => {
    const card = buildPermissionCard(makePermissionRequest({ command: 'ls' }), 3);
    expect(card).toMatchObject({
      source: { desc: 'Lynel', desc_color: 0 },
    });
  });
});

describe('buildAskQuestionCard', () => {
  it('questions 为空数组时返回空数组', () => {
    expect(buildAskQuestionCard(3, { questions: [] })).toEqual([]);
    expect(buildAskQuestionCard(3, {})).toEqual([]);
  });

  it('单问题单选构建 vote_interaction，标题为问题文本，描述含单选标识', () => {
    const cards = buildAskQuestionCard(3, {
      questions: [
        {
          header: '框架选择',
          question: '用哪个测试框架？',
          multiSelect: false,
          options: [{ label: 'Vitest' }, { label: 'Jest' }],
        },
      ],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      card_type: 'vote_interaction',
      source: { desc: 'Lynel', desc_color: 0 },
      main_title: {
        title: '用哪个测试框架？',
        desc: '单选',
      },
      task_id: 'seq-3-0',
      checkbox: {
        question_key: 'wecom:answer:seq-3:0',
        mode: 0,
        option_list: [
          { id: 'wecom:opt:seq-3:0:0', text: 'Vitest' },
          { id: 'wecom:opt:seq-3:0:1', text: 'Jest' },
        ],
      },
      submit_button: {
        text: '提交',
        key: 'wecom:submit:seq-3',
      },
    });
  });

  it('单问题多选构建 vote_interaction，mode=1，标题为问题文本', () => {
    const cards = buildAskQuestionCard(3, {
      questions: [
        {
          header: '依赖选择',
          question: '安装哪些依赖？',
          multiSelect: true,
          options: [{ label: 'eslint' }, { label: 'prettier' }],
        },
      ],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      card_type: 'vote_interaction',
      source: { desc: 'Lynel', desc_color: 0 },
      main_title: {
        title: '安装哪些依赖？',
        desc: '多选',
      },
      task_id: 'seq-3-0',
      checkbox: {
        question_key: 'wecom:answer:seq-3:0',
        mode: 1,
        option_list: [
          { id: 'wecom:opt:seq-3:0:0', text: 'eslint' },
          { id: 'wecom:opt:seq-3:0:1', text: 'prettier' },
        ],
      },
      submit_button: {
        text: '提交',
        key: 'wecom:submit:seq-3',
      },
    });
  });

  it('多个问题构建多张 vote_interaction 卡片，每问题一张', () => {
    const cards = buildAskQuestionCard(3, {
      questions: [
        { question: 'Q1', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
        { question: 'Q2', multiSelect: true, options: [{ label: 'C' }, { label: 'D' }] },
      ],
    }, undefined, undefined, 2);

    expect(cards).toHaveLength(2);
    // 第一张：单选 mode=0，标题带"问题 1/2"前缀
    expect(cards[0]).toMatchObject({
      card_type: 'vote_interaction',
      main_title: { title: '问题 1/2：Q1', desc: '单选' },
      checkbox: { question_key: 'wecom:answer:seq-3:0', mode: 0 },
    });
    // 第二张：多选 mode=1，标题带"问题 2/2"前缀
    expect(cards[1]).toMatchObject({
      card_type: 'vote_interaction',
      main_title: { title: '问题 2/2：Q2', desc: '多选' },
      checkbox: { question_key: 'wecom:answer:seq-3:1', mode: 1 },
    });
  });

  it('传入 requestId 时所有 key 使用 requestId 替代 seq', () => {
    const cards = buildAskQuestionCard(3, {
      questions: [
        {
          header: '确认',
          question: '是否继续？',
          multiSelect: false,
          options: [{ label: '是' }, { label: '否' }],
        },
      ],
    }, 'custom-req-123');

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      card_type: 'vote_interaction',
      task_id: 'custom-req-123-0',
      checkbox: {
        question_key: 'wecom:answer:custom-req-123:0',
        option_list: [
          { id: 'wecom:opt:custom-req-123:0:0' },
          { id: 'wecom:opt:custom-req-123:0:1' },
        ],
      },
      submit_button: {
        key: 'wecom:submit:custom-req-123',
      },
    });
  });

  it('传入 sessionTitle 时单问题卡片 source.desc 使用项目前缀', () => {
    const cards = buildAskQuestionCard(3, {
      questions: [
        { question: 'Q1', multiSelect: false, options: [{ label: 'A' }] },
      ],
    }, undefined, '我的会话');

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      source: { desc: '项目：我的会话', desc_color: 0 },
    });
  });

  it('传入 sessionTitle 时多问题每张卡片 source.desc 都使用项目前缀', () => {
    const cards = buildAskQuestionCard(3, {
      questions: [
        { question: 'Q1', multiSelect: false, options: [{ label: 'A' }] },
        { question: 'Q2', multiSelect: false, options: [{ label: 'B' }] },
      ],
    }, undefined, '项目讨论');

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ source: { desc: '项目：项目讨论' } });
    expect(cards[1]).toMatchObject({ source: { desc: '项目：项目讨论' } });
  });
});
