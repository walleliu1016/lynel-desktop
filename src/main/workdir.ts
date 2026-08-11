import os from 'node:os';

/** 创建会话时规范化工作目录：空白回退到用户主目录（快速开会话未选目录时的兜底） */
export function normalizeWorkdir(workdir?: string): string {
  const w = (workdir || '').trim();
  return w || os.homedir();
}
