export type SessionState = 'idle' | 'running' | 'awaiting_permission' | 'done';

export interface Session {
  id: string;
  workDir: string;
  state: SessionState;
  lastHookAt: number;
  // WeComChannel 兼容：检查 session 是否仍在运行
  // VS Code 中无 PTY 进程，用此标记表示终端仍活跃
  process: { pid: number } | null;
}

const sessions = new Map<string, Session>();

// 终端消息发送回调（由 TerminalManager 注入）
let sessionSender: ((id: string, text: string) => void) | null = null;
let sessionInputWriter: ((id: string, data: string) => void) | null = null;

export function setSessionSender(fn: (id: string, text: string) => void): void {
  sessionSender = fn;
}

export function setSessionInputWriter(fn: (id: string, data: string) => void): void {
  sessionInputWriter = fn;
}

export function newSession(id: string, workDir: string): Session {
  return { id, workDir, state: 'idle', lastHookAt: 0, process: { pid: 0 } };
}

export function register(session: Session): void { sessions.set(session.id, session); }
export function lookup(id: string): Session | undefined { return sessions.get(id); }

export function remove(id: string): void {
  const s = sessions.get(id);
  if (s) s.process = null;
  sessions.delete(id);
}

export function list(): Session[] { return Array.from(sessions.values()); }

export function touch(id: string): void {
  const s = sessions.get(id);
  if (s) s.lastHookAt = Date.now();
}

export function setState(id: string, state: SessionState): void {
  const s = sessions.get(id);
  if (s) s.state = state;
}

/** 向终端发送文本，自动补回车（企业微信消息路由用） */
export function send(id: string, text: string): void {
  if (!sessionSender) throw new Error('session sender not set');
  sessionSender(id, text);
}

/** 向终端写入原始输入（控制字符等） */
export function writeInput(id: string, data: string): void {
  if (!sessionInputWriter) throw new Error('session input writer not set');
  sessionInputWriter(id, data);
}

/** 获取终端 buffer（VS Code 终端不支持读取，返回空串） */
export function getBuffer(_id: string): string {
  return '';
}

/** 获取终端尺寸 */
export function getSize(_id: string): { cols: number; rows: number } | undefined {
  return { cols: 80, rows: 24 };
}
