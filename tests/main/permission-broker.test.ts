import { describe, it, expect, vi } from 'vitest';
import { permissionBroker } from '../../src/main/permission-broker.js';

describe('PermissionBroker 终端授权取消', () => {
  it('cancelBySessionTool 触发 onCancel 时携带 sessionId 与 toolName', () => {
    const onCancel = vi.fn();
    permissionBroker.onCancel(onCancel);

    void permissionBroker.wait({
      id: 'req-terminal-1',
      sessionId: 'sid-1',
      workDir: '/wd',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    });

    const cancelled = permissionBroker.cancelBySessionTool('sid-1', 'Bash');

    expect(cancelled).toBe(true);
    expect(onCancel).toHaveBeenCalledWith('req-terminal-1', 'sid-1', 'Bash');
  });

  it('resolveBySession 按 sessionId 定位待处理请求', async () => {
    const p = permissionBroker.wait({
      id: 'req-sess-1',
      sessionId: 'sid-2',
      workDir: '/wd',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    });

    const ok = permissionBroker.resolveBySession('sid-2', 'allow', 'wecom');

    expect(ok).toBe(true);
    await expect(p).resolves.toEqual({ decision: 'allow', answers: undefined });
    // 无待处理请求的 session 返回 false
    expect(permissionBroker.resolveBySession('sid-2', 'allow', 'wecom')).toBe(false);
  });

  it('getPendingBySession 返回该 session 最新一条待处理请求', () => {
    void permissionBroker.wait({
      id: 'req-a',
      sessionId: 'sid-3',
      workDir: '/wd',
      toolName: 'Read',
      toolInput: {},
    });
    void permissionBroker.wait({
      id: 'req-b',
      sessionId: 'sid-3',
      workDir: '/wd',
      toolName: 'AskUserQuestion',
      toolInput: {},
    });

    const entry = permissionBroker.getPendingBySession('sid-3');
    expect(entry?.id).toBe('req-b');
    expect(permissionBroker.getPendingBySession('sid-none')).toBeUndefined();
  });
});
